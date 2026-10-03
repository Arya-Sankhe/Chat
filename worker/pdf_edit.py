"""Format-preserving edits to an existing PDF.

The PDF is edited in place with PDFium: text is located through the text page (every character
knows the text object that draws it), the affected text objects are removed and the new text is
drawn in their place with the same font, size, colour and baseline. The document's own embedded
font is reused whenever it already draws every character the new text needs (a subset font only
holds the glyphs the document used); otherwise a metric-compatible Liberation face stands in.
Everything that is not addressed stays byte-for-byte the same content.

Form fields (AcroForm) are filled with pypdf, which keeps the form interactive.

Operations
  {"type": "fill_field", "name": "...", "value": "..."}            AcroForm text / checkbox / choice
  {"type": "replace_text", "find": "...", "replace": "...", "page": n?, "line": "p1.l3"?, "all": bool?}
  {"type": "rewrite_lines", "lines": ["p2.l4", "p2.l5"], "text": "..."}   rewrap a paragraph in place
  {"type": "insert_text", "page": n, "anchor": "Name:", "line": "p1.l3" (optional), "text": "...", "position": "right"|"below"}
  {"type": "insert_text", "page": n, "x": pt, "y": pt, "text": "...", "size": pt?}
  {"type": "delete_text", "find": "...", "page": n?}
"""

import ctypes
import os
import re
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as raw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

LIBERATION_DIRS = ["/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/liberation2"]
FALLBACK_FILES = {
    ("sans", False, False): "LiberationSans-Regular.ttf",
    ("sans", True, False): "LiberationSans-Bold.ttf",
    ("sans", False, True): "LiberationSans-Italic.ttf",
    ("sans", True, True): "LiberationSans-BoldItalic.ttf",
    ("serif", False, False): "LiberationSerif-Regular.ttf",
    ("serif", True, False): "LiberationSerif-Bold.ttf",
    ("serif", False, True): "LiberationSerif-Italic.ttf",
    ("serif", True, True): "LiberationSerif-BoldItalic.ttf",
    ("mono", False, False): "LiberationMono-Regular.ttf",
    ("mono", True, False): "LiberationMono-Bold.ttf",
    ("mono", False, True): "LiberationMono-Italic.ttf",
    ("mono", True, True): "LiberationMono-BoldItalic.ttf",
}


class PdfEditError(RuntimeError):
    pass


def _ptr(obj):
    return ctypes.cast(obj, ctypes.c_void_p).value if obj else None


def _wide(text):
    data = (text + "\x00").encode("utf-16-le")
    buffer = ctypes.create_string_buffer(data, len(data))
    return ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ushort)), buffer


def _norm(text):
    return re.sub(r"\s+", " ", str(text or "").replace(" ", " ")).strip()


# ------------------------------------------------------------------------------------------------
# Layout


def _font_name(textpage, index):
    flags = ctypes.c_int(0)
    size = raw.FPDFText_GetFontInfo(textpage, index, None, 0, ctypes.byref(flags))
    if size <= 0:
        return "", 0
    buffer = ctypes.create_string_buffer(size)
    raw.FPDFText_GetFontInfo(textpage, index, buffer, size, ctypes.byref(flags))
    return buffer.value.decode("utf-8", "replace"), flags.value


def page_chars(page):
    textpage = page.get_textpage()
    tp = textpage.raw
    count = raw.FPDFText_CountChars(tp)
    chars = []
    left, right, bottom, top = (ctypes.c_double() for _ in range(4))
    ox, oy = ctypes.c_double(), ctypes.c_double()
    r, g, b, a = (ctypes.c_uint() for _ in range(4))
    for index in range(count):
        code = raw.FPDFText_GetUnicode(tp, index)
        char = chr(code) if code else ""
        if not char:
            continue
        generated = bool(raw.FPDFText_IsGenerated(tp, index))
        raw.FPDFText_GetCharBox(tp, index, ctypes.byref(left), ctypes.byref(right), ctypes.byref(bottom), ctypes.byref(top))
        raw.FPDFText_GetCharOrigin(tp, index, ctypes.byref(ox), ctypes.byref(oy))
        obj = raw.FPDFText_GetTextObject(tp, index)
        font, flags = _font_name(tp, index)
        raw.FPDFText_GetFillColor(tp, index, ctypes.byref(r), ctypes.byref(g), ctypes.byref(b), ctypes.byref(a))
        chars.append({
            "i": index, "ch": char, "generated": generated,
            "x0": left.value, "x1": right.value, "y0": bottom.value, "y1": top.value,
            "ox": ox.value, "oy": oy.value,
            "size": raw.FPDFText_GetFontSize(tp, index),
            "weight": raw.FPDFText_GetFontWeight(tp, index),
            "font": font, "flags": flags,
            "obj": _ptr(obj), "obj_handle": obj,
            "color": (r.value, g.value, b.value, a.value),
        })
    return chars, textpage


def group_lines(chars, page_no):
    """Characters -> visual lines (and separate segments on one baseline, e.g. table cells)."""
    lines = []
    current = None
    last = None
    for char in chars:
        if char["ch"] in "\r\n":
            if current:
                current["ended"] = True
            continue
        has_box = char["x1"] > char["x0"] or char["y1"] > char["y0"]
        size = max(char["size"], 1.0)
        if current and not current.get("ended") and last is not None:
            same_line = abs(char["oy"] - current["oy"]) <= 0.45 * max(size, current["size"])
            gap = char["ox"] - (last["x1"] if last["x1"] > last["x0"] else last["ox"])
            backwards = char["ox"] < last["ox"] - size * 0.5
            if not same_line or backwards or (has_box and gap > max(2.2 * size, 14)):
                current = None
        elif current and current.get("ended"):
            current = None
        if current is None:
            if char["ch"].isspace():
                continue
            current = {"chars": [], "oy": char["oy"], "size": size}
            lines.append(current)
        current["chars"].append(char)
        if has_box:
            last = char
        elif last is None:
            last = char
    out = []
    for number, line in enumerate(lines, start=1):
        cs = line["chars"]
        while cs and cs[-1]["ch"].isspace():
            cs.pop()
        if not cs:
            continue
        boxed = [c for c in cs if c["x1"] > c["x0"]]
        if not boxed:
            continue
        sizes = sorted(c["size"] for c in boxed)
        text = "".join(c["ch"] for c in cs)
        out.append({
            "id": f"p{page_no}.l{len(out) + 1}",
            "page": page_no,
            "text": text,
            "chars": cs,
            "x0": min(c["x0"] for c in boxed), "x1": max(c["x1"] for c in boxed),
            "y0": min(c["y0"] for c in boxed), "y1": max(c["y1"] for c in boxed),
            "oy": cs[0]["oy"], "ox": cs[0]["ox"],
            "size": sizes[len(sizes) // 2],
            "font": boxed[0]["font"],
            "bold": boxed[0]["weight"] >= 600 or "bold" in boxed[0]["font"].lower(),
            "objs": list(dict.fromkeys(c["obj"] for c in cs if c["obj"])),
        })
    return out


def _qualified_name(annot):
    parts = []
    node = annot
    for _ in range(20):
        if node is None:
            break
        if node.get("/T") is not None:
            parts.append(str(node.get("/T")))
        parent = node.get("/Parent")
        node = parent.get_object() if parent is not None else None
    return ".".join(reversed(parts))


WIDGET_LIMIT = 40


def field_widgets(reader, heights):
    """Where each field is drawn: ({qualified name: [{page, x, y, w, h}]}, {names with a widget whose
    position is unknown}). A widget's /Rect is in the same page space as PDFium's character boxes,
    and y is measured down from the same page height the text lines use (PDFium's, which accounts
    for /Rotate), so widgets and lines compare directly on any page, rotated or not."""
    widgets = {}
    unplaced = set()
    for index, page in enumerate(reader.pages):
        try:
            annots = page.get("/Annots") or []
            annots = annots.get_object() if hasattr(annots, "get_object") else annots
        except Exception:
            annots = []
        height = float(heights[index]) if index < len(heights) else None
        for ref in annots:
            try:
                annot = ref.get_object()
                if annot.get("/Subtype") != "/Widget":
                    continue
                name = _qualified_name(annot)
            except Exception:
                continue
            if not name:
                continue
            try:
                x0, y0, x1, y1 = (float(value) for value in annot["/Rect"])
                if height is None:
                    raise ValueError("page height unknown")
            except Exception:
                unplaced.add(name)
                continue
            widgets.setdefault(name, []).append({
                "page": index + 1, "x": round(min(x0, x1), 1), "y": round(height - max(y0, y1), 1),
                "w": round(abs(x1 - x0), 1), "h": round(abs(y1 - y0), 1),
            })
    return widgets, unplaced


def acro_fields(path, heights=()):
    try:
        reader = PdfReader(str(path))
        fields = reader.get_fields() or {}
    except Exception:
        return []
    try:
        widgets, unplaced = field_widgets(reader, heights)
    except Exception:
        widgets, unplaced = {}, set()
    out = []
    for name, field in fields.items():
        kind = str(field.get("/FT") or "")
        if kind not in ("/Tx", "/Btn", "/Ch"):
            continue
        entry = {"name": name, "type": {"/Tx": "text", "/Btn": "checkbox", "/Ch": "choice"}[kind], "value": str(field.get("/V") or "").lstrip("/")}
        states = field.get("/_States_")
        if states:
            entry["options"] = [str(state).lstrip("/") for state in states if str(state) != "/Off"]
        options = field.get("/Opt")
        if options:
            entry["options"] = [str(item[0] if isinstance(item, list) else item) for item in options][:40]
        label = field.get("/TU")
        if label:
            entry["label"] = str(label)[:120]
        # Every widget, since a value fills them all; "widgets_partial" when some could not be placed
        # (or there are too many to list), so a selection can never be shown to cover the field.
        if widgets.get(name):
            entry["widgets"] = widgets[name][:WIDGET_LIMIT]
        if name in unplaced or len(widgets.get(name) or []) > WIDGET_LIMIT:
            entry["widgets_partial"] = True
        out.append(entry)
    return out


def outline(path, max_chars=120_000):
    """What the editing model sees: form fields, and every text line with an id and position."""
    pdf = pdfium.PdfDocument(str(path))
    pages = []
    total = 0
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            chars, textpage = page_chars(page)
            lines = group_lines(chars, index + 1)
            width, height = page.get_size()
            entries = []
            for line in lines:
                entry = {"id": line["id"], "text": line["text"], "x": round(line["x0"], 1), "y": round(height - line["y1"], 1), "w": round(line["x1"] - line["x0"], 1), "size": round(line["size"], 1)}
                if line["bold"]:
                    entry["bold"] = True
                total += len(line["text"]) + 40
                if total > max_chars:
                    break
                entries.append(entry)
            pages.append({"page": index + 1, "width": round(width, 1), "height": round(height, 1), "lines": entries})
            textpage.close()
            page.close()
            if total > max_chars:
                break
        # Every page's height (the same value the lines above use), for placing form-field widgets.
        heights = []
        for index in range(len(pdf)):
            page = pdf[index]
            heights.append(page.get_height())
            page.close()
    finally:
        pdf.close()
    return {"kind": "pdf", "fields": acro_fields(path, heights), "pages": pages, "has_text": any(page["lines"] for page in pages)}


# ------------------------------------------------------------------------------------------------
# Editing


class Editor:
    def __init__(self, path):
        self.path = Path(path)
        self.pdf = pdfium.PdfDocument(str(path))
        self.loaded_fonts = {}
        self.font_chars = {}
        self.width_cache = {}
        self.dirty_pages = set()
        self.warnings = []
        self.drawn = []
        # Line ids as the outline gave them. Redrawing a line re-orders the page's text objects,
        # so ids recomputed after an edit would point at other lines: every id an operation names
        # is resolved against these original lines, by where they sit on the page.
        self.original_lines = {}
        self._index_font_chars()

    def close(self):
        for font in self.loaded_fonts.values():
            try:
                raw.FPDFFont_Close(font)
            except Exception:
                pass
        self.pdf.close()

    def _index_font_chars(self):
        # Characters each embedded font already draws: a subset font can draw exactly these.
        for index in range(len(self.pdf)):
            page = self.pdf[index]
            chars, textpage = page_chars(page)
            for char in chars:
                if char["generated"] or char["ch"] in "\r\n":
                    continue
                self.font_chars.setdefault(char["font"], set()).add(char["ch"])
            self.original_lines[index + 1] = {
                line["id"]: {key: line[key] for key in ("oy", "ox", "x0", "x1", "size")}
                for line in group_lines(chars, index + 1)
            }
            textpage.close()

    @staticmethod
    def line_page(line_id):
        match = re.match(r"^p(\d+)\.l\d+$", str(line_id or ""))
        return int(match.group(1)) if match else None

    def resolve_line(self, line_id, lines):
        """The current line (from `lines`) at the place the original line `line_id` was."""
        page_no = self.line_page(line_id)
        original = self.original_lines.get(page_no, {}).get(str(line_id))
        if not original:
            return None
        best, best_overlap = None, 0.0
        for line in lines:
            if abs(line["oy"] - original["oy"]) > 0.45 * max(line["size"], original["size"]):
                continue
            overlap = min(line["x1"], original["x1"]) - max(line["x0"], original["x0"])
            if overlap > best_overlap or (best is None and abs(line["ox"] - original["ox"]) < 2):
                best, best_overlap = line, max(overlap, best_overlap)
        return best

    def lines(self, page_no):
        page = self.pdf[page_no - 1]
        chars, textpage = page_chars(page)
        lines = group_lines(chars, page_no)
        return page, lines, textpage

    # Fonts ---------------------------------------------------------------------------------------

    def _fallback_font(self, style):
        name = (style["font"] or "").lower()
        family = "mono" if any(k in name for k in ("mono", "courier", "consol", "code")) else "serif" if (
            style["flags"] & 2 or any(k in name for k in ("times", "serif", "roman", "georgia", "garamond", "cambria", "minion", "palatino", "book", "cmr", "lmroman"))
        ) and "sans" not in name else "sans"
        bold = style["weight"] >= 600 or "bold" in name or "black" in name or "heavy" in name
        italic = bool(style["flags"] & 64) or "italic" in name or "oblique" in name
        key = (family, bold, italic)
        if key in self.loaded_fonts:
            return self.loaded_fonts[key]
        file = FALLBACK_FILES[key]
        font_path = next((Path(d) / file for d in LIBERATION_DIRS if (Path(d) / file).exists()), None)
        if font_path is None:
            standard = {"sans": "Helvetica", "serif": "Times-Roman", "mono": "Courier"}[family]
            if bold or italic:
                standard = {"Helvetica": "Helvetica-" + ("BoldOblique" if bold and italic else "Bold" if bold else "Oblique"),
                            "Times-Roman": "Times-" + ("BoldItalic" if bold and italic else "Bold" if bold else "Italic"),
                            "Courier": "Courier-" + ("BoldOblique" if bold and italic else "Bold" if bold else "Oblique")}[standard]
            font = raw.FPDFText_LoadStandardFont(self.pdf.raw, standard.encode())
        else:
            data = font_path.read_bytes()
            buffer = (ctypes.c_uint8 * len(data)).from_buffer_copy(data)
            font = raw.FPDFText_LoadFont(self.pdf.raw, buffer, len(data), raw.FPDF_FONT_TRUETYPE, True)
            self._keep = getattr(self, "_keep", []) + [buffer]
        if not font:
            raise PdfEditError("font_load_failed")
        self.loaded_fonts[key] = font
        return font

    def font_for(self, style, text):
        """The original font when it can draw every character of the new text."""
        needed = {ch for ch in text if ch != " "}
        available = self.font_chars.get(style["font"], set())
        if style.get("font_handle") and needed <= available and style["font"] not in self.bad_fonts:
            return style["font_handle"], True
        if any(ord(ch) >= 0x2190 for ch in needed):
            # Ticks, arrows and other symbols: the Liberation faces have none of them.
            symbol = self._symbol_font()
            if symbol:
                return symbol, False
        return self._fallback_font(style), False

    def _symbol_font(self):
        if "symbol" in self.loaded_fonts:
            return self.loaded_fonts["symbol"]
        path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        if not path.exists():
            return None
        data = path.read_bytes()
        buffer = (ctypes.c_uint8 * len(data)).from_buffer_copy(data)
        font = raw.FPDFText_LoadFont(self.pdf.raw, buffer, len(data), raw.FPDF_FONT_TRUETYPE, True)
        self._keep = getattr(self, "_keep", []) + [buffer]
        self.loaded_fonts["symbol"] = font or None
        return self.loaded_fonts["symbol"]

    @property
    def bad_fonts(self):
        if not hasattr(self, "_bad_fonts"):
            self._bad_fonts = set()
        return self._bad_fonts

    def has_space(self, style):
        """A real space glyph with a real advance (Chromium subsets give spaces no width)."""
        if not hasattr(self, "_space_ok"):
            self._space_ok = {}
        name = style["font"]
        if name not in self._space_ok:
            ok = " " in self.font_chars.get(name, set()) and bool(style.get("font_handle"))
            if ok:
                size = max(style["obj_size"], 1.0)
                ok = self._bounds_width(style["font_handle"], size, "H H") - self._bounds_width(style["font_handle"], size, "HH") > size * 0.15
            self._space_ok[name] = ok
        return self._space_ok[name]

    def text_width(self, font, size, text):
        """Advance width of text in the font at size (page units at matrix scale 1)."""
        total = 0.0
        for ch in text:
            key = (_ptr(font), round(size, 2), ch)
            if key not in self.width_cache:
                self.width_cache[key] = self._measure_char(font, size, ch)
            total += self.width_cache[key]
        return total

    def _bounds_width(self, font, size, text):
        obj = raw.FPDFPageObj_CreateTextObj(self.pdf.raw, font, ctypes.c_float(size))
        if not obj:
            return 0.0
        wide, keep = _wide(text)
        raw.FPDFText_SetText(obj, wide)
        left, bottom, right, top = (ctypes.c_float() for _ in range(4))
        raw.FPDFPageObj_GetBounds(obj, ctypes.byref(left), ctypes.byref(bottom), ctypes.byref(right), ctypes.byref(top))
        raw.FPDFPageObj_Destroy(obj)
        return max(0.0, right.value - left.value)

    def _measure_char(self, font, size, ch):
        both = self._bounds_width(font, size, f"H{ch}H")
        base = self._bounds_width(font, size, "HH")
        width = both - base
        if width <= 0:
            width = size * (0.28 if ch.isspace() else 0.5)
        return width

    # Drawing -------------------------------------------------------------------------------------

    def _style_of(self, char):
        obj = char["obj_handle"]
        matrix = raw.FS_MATRIX()
        raw.FPDFPageObj_GetMatrix(obj, ctypes.byref(matrix))
        size = ctypes.c_float()
        raw.FPDFTextObj_GetFontSize(obj, ctypes.byref(size))
        return {
            "font_handle": raw.FPDFTextObj_GetFont(obj),
            "font": char["font"], "flags": char["flags"], "weight": char["weight"],
            "obj_size": size.value or char["size"],
            "matrix": (matrix.a, matrix.b, matrix.c, matrix.d),
            "color": char["color"],
            "render_mode": raw.FPDFTextObj_GetTextRenderMode(obj),
        }

    def run_width(self, text, style, scale_font=1.0):
        font, original = self.font_for(style, text)
        size = style["obj_size"] * scale_font
        a = style["matrix"][0]
        if original and not self.has_space(style) and " " in text:
            words = text.split(" ")
            space = size * 0.27
            return sum(self.text_width(font, size, word) * a for word in words) + space * a * (len(words) - 1)
        return self.text_width(font, size, text) * a

    def _draw_run(self, page, text, style, x, y, scale_font=1.0):
        if not text:
            return 0.0
        font, original = self.font_for(style, text)
        # Subset fonts without a space glyph (Chromium, Skia) get one text object per word.
        if original and not self.has_space(style) and " " in text:
            size = style["obj_size"] * scale_font
            space = size * 0.27 * style["matrix"][0]
            start = x
            for index, word in enumerate(text.split(" ")):
                if index:
                    x += space
                if word:
                    x += self._draw_object(page, word, style, x, y, scale_font, font, True)
            return x - start
        return self._draw_object(page, text, style, x, y, scale_font, font, original)

    def _draw_object(self, page, text, style, x, y, scale_font, font, original):
        a, b, c, d = style["matrix"]
        size = style["obj_size"] * scale_font
        obj = raw.FPDFPageObj_CreateTextObj(self.pdf.raw, font, ctypes.c_float(size))
        if not obj:
            raise PdfEditError("text_object_failed")
        wide, keep = _wide(text)
        if not raw.FPDFText_SetText(obj, wide):
            raw.FPDFPageObj_Destroy(obj)
            raise PdfEditError("set_text_failed")
        red, green, blue, alpha = style["color"]
        raw.FPDFPageObj_SetFillColor(obj, red, green, blue, alpha or 255)
        matrix = raw.FS_MATRIX(a, b, c, d, x, y)
        raw.FPDFPageObj_SetMatrix(obj, ctypes.byref(matrix))
        raw.FPDFPage_InsertObject(page.raw, obj)
        self.drawn.append((obj, text, style, original))
        if not original and style["font"] not in self.warned_fonts():
            self.warnings.append(f"{style['font'] or 'a font'} lacks some characters; used a matching standard face")
            self._warned.add(style["font"])
        return self.text_width(font, size, text) * a

    def warned_fonts(self):
        if not hasattr(self, "_warned"):
            self._warned = set()
        return self._warned

    def _verify(self, page):
        reused = [(obj, text, style) for obj, text, style, original in self.drawn if original]
        if not reused:
            return set()
        textpage = raw.FPDFText_LoadPage(page.raw)
        failed = set()
        try:
            for obj, text, style in reused:
                length = raw.FPDFTextObj_GetText(obj, textpage, None, 0)
                buffer = (ctypes.c_ushort * max(1, length))()
                raw.FPDFTextObj_GetText(obj, textpage, buffer, length)
                decoded = bytes(buffer)[: max(0, (length - 1) * 2)].decode("utf-16-le", "replace")
                if _norm(decoded) != _norm(text):
                    failed.add(style["font"])
        finally:
            raw.FPDFText_ClosePage(textpage)
        return failed

    def _runs(self, chars):
        """Original line text split into runs drawn by the same text object."""
        runs = []
        for char in chars:
            if runs and runs[-1]["obj"] == char["obj"]:
                runs[-1]["chars"].append(char)
            elif runs and char["generated"]:
                runs[-1]["chars"].append(char)
            else:
                runs.append({"obj": char["obj"], "chars": [char]})
        return runs

    def _remove_objects(self, page, handles):
        for handle in handles:
            if raw.FPDFPage_RemoveObject(page.raw, handle):
                raw.FPDFPageObj_Destroy(handle)

    def redraw_lines(self, page_no, edits):
        """edits: {line_id: new_text_or_callable}. Lines sharing a text object are redrawn together."""
        page, lines, textpage = self.lines(page_no)
        try:
            by_id = {line["id"]: line for line in lines}
            targets = [by_id[line_id] for line_id in edits if line_id in by_id]
            if not targets:
                return 0
            objs = set()
            for line in targets:
                objs.update(line["objs"])
            # Any other line drawn by one of these objects must be redrawn as it was.
            cluster = {line["id"]: line for line in targets}
            changed = True
            while changed:
                changed = False
                for line in lines:
                    if line["id"] not in cluster and objs.intersection(line["objs"]):
                        cluster[line["id"]] = line
                        objs.update(line["objs"])
                        changed = True
            handles = {}
            for line in cluster.values():
                for char in line["chars"]:
                    if char["obj"] in objs and char["obj"] not in handles:
                        handles[char["obj"]] = char["obj_handle"]
            # Every character of a removed object must be redrawn: check nothing is lost.
            plan = []
            for line in cluster.values():
                boxed = [c for c in line["chars"] if c["obj"]]
                if not boxed:
                    continue
                a, b, c, d = self._style_of(boxed[0])["matrix"]
                if abs(b) > 1e-3 or abs(c) > 1e-3:
                    raise PdfEditError("rotated_text_not_supported")
                new = edits.get(line["id"])
                # Generated characters (word spaces a PDF positions rather than draws) stay in the text.
                chars = line["chars"][line["chars"].index(boxed[0]):]
                runs = [(("".join(ch["ch"] for ch in run["chars"])), self._style_of(next(ch for ch in run["chars"] if ch["obj"]))) for run in self._runs(chars)]
                if callable(new):
                    runs = new(runs)
                elif isinstance(new, str):
                    runs = _replace_runs(runs, new)
                plan.append((line, runs))
            self._remove_objects(page, handles.values())
            width = page.get_width()
            for line, runs in plan:
                for attempt in range(2):
                    self.drawn = []
                    natural = sum(self.run_width(text, style) for text, style in runs)
                    old_width = line["x1"] - line["ox"]
                    centered = line["ox"] > 60 and abs((line["ox"] + line["x1"]) / 2 - width / 2) < 4 and (line["x1"] < width - 60)
                    x = line["ox"] + (old_width - natural) / 2 if centered else line["ox"]
                    y = line["oy"]
                    available = (width - 24) - x
                    scale = 1.0
                    if natural > available > 0:
                        scale = max(0.82, available / natural)
                    for text, style in runs:
                        x += self._draw_run(page, text, style, x, y, scale)
                    # A reused subset font must decode back to the text it was asked to draw;
                    # if it does not, its encoding cannot express these characters.
                    failed = self._verify(page)
                    if not failed or attempt:
                        break
                    self.bad_fonts.update(failed)
                    self._remove_objects(page, [obj for obj, *_ in self.drawn])
            raw.FPDFPage_GenerateContent(page.raw)
            self.dirty_pages.add(page_no)
            return len(targets)
        finally:
            textpage.close()

    # Operations ----------------------------------------------------------------------------------

    def replace_text(self, find, replace, page=None, line_id=None, replace_all=True):
        needle = _norm(find)
        if not needle:
            return 0
        count = 0
        if line_id:
            page = self.line_page(line_id)
            if page is None:
                raise PdfEditError(f"line not found: {line_id}")
        pages = [page] if page else range(1, len(self.pdf) + 1)
        for page_no in pages:
            if page_no < 1 or page_no > len(self.pdf):
                continue
            _page, lines, textpage = self.lines(page_no)
            textpage.close()
            if line_id:
                target = self.resolve_line(line_id, lines)
                if target is None:
                    raise PdfEditError(f"line not found: {line_id}")
                lines = [target]
            edits = {}
            for line in lines:
                text = _norm(line["text"])
                if needle in text:
                    edits[line["id"]] = (needle, replace)
            if not edits:
                continue

            def editor(pair):
                target, value = pair

                def apply(runs):
                    return _replace_in_runs(runs, target, value, replace_all)
                return apply

            count += self.redraw_lines(page_no, {key: editor(value) for key, value in edits.items()})
            if count and not replace_all:
                break
        return count

    def rewrite_lines(self, line_ids, text):
        """Replace a paragraph (several lines) with new text wrapped into the same box."""
        if not line_ids:
            return 0
        page_no = self.line_page(line_ids[0])
        if page_no is None or page_no > len(self.pdf) or any(self.line_page(line_id) != page_no for line_id in line_ids):
            raise PdfEditError("rewrite_lines needs line ids from one page")
        page, lines, textpage = self.lines(page_no)
        textpage.close()
        chosen = []
        for line_id in line_ids:
            line = self.resolve_line(line_id, lines)
            if line is None:
                raise PdfEditError(f"line not found: {line_id}")
            if line not in chosen:
                chosen.append(line)
        chosen.sort(key=lambda line: -line["oy"])
        style = self._style_of(next(c for c in chosen[0]["chars"] if c["obj"]))
        left = min(line["ox"] for line in chosen)
        right = max(line["x1"] for line in chosen)
        if len(chosen) == 1:
            right = max(right, page.get_width() - 54)
        leading = (chosen[0]["oy"] - chosen[-1]["oy"]) / (len(chosen) - 1) if len(chosen) > 1 else chosen[0]["size"] * 1.25
        # Room below the paragraph down to the next line of text.
        below = [line for line in lines if line["oy"] < chosen[-1]["oy"] - 1 and line["x1"] > left and line["x0"] < right]
        floor = max((line["y1"] for line in below), default=36)
        for scale in (1.0, 0.95, 0.9, 0.85, 0.8):
            wrapped = _wrap(text, lambda value: self.run_width(value, style, scale), right - left)
            bottom = chosen[0]["oy"] - leading * scale * (len(wrapped) - 1)
            if bottom - chosen[0]["size"] * 0.25 >= floor or scale == 0.8:
                break
        edits = {}
        for index, line in enumerate(chosen):
            edits[line["id"]] = (lambda runs: [])
        # Remove the old lines, then draw the wrapped text from the first baseline.
        self.redraw_lines(page_no, edits)
        page = self.pdf[page_no - 1]
        y = chosen[0]["oy"]
        for value in wrapped:
            self._draw_run(page, value, style, left, y, scale)
            y -= leading * scale
        raw.FPDFPage_GenerateContent(page.raw)
        if bottom < floor:
            self.warnings.append(f"the new text on page {page_no} is longer than the space it replaces")
        return len(chosen)

    def insert_text(self, text, page_no, anchor=None, position="right", x=None, y=None, size=None, line_id=None):
        if line_id:
            page_no = self.line_page(line_id) or page_no
        page, lines, textpage = self.lines(page_no)
        textpage.close()
        if anchor:
            needle = _norm(anchor)
            if line_id:
                # The anchor on that exact line, not the first line on the page with the same label.
                hit = self.resolve_line(line_id, lines)
                if not hit or needle not in _norm(hit["text"]):
                    raise PdfEditError(f"anchor_not_found: {anchor[:60]} on line {line_id}")
            else:
                hit = next((line for line in lines if needle in _norm(line["text"])), None)
            if not hit:
                raise PdfEditError(f"anchor_not_found: {anchor[:60]}")
            # The anchor's own characters give the exact end of the label.
            joined = "".join(c["ch"] for c in hit["chars"])
            start = _norm_index(joined, needle)
            end_chars = [c for c in hit["chars"][start:start + len(needle) + joined[start:].count("  ")] if c["x1"] > c["x0"]]
            style = self._style_of(next(c for c in hit["chars"] if c["obj"]))
            style["weight"] = 400
            if position == "below":
                draw_x, draw_y = hit["ox"], hit["oy"] - hit["size"] * 1.35
            else:
                end = end_chars[-1]["x1"] if end_chars else hit["x1"]
                draw_x, draw_y = end + hit["size"] * 0.5, hit["oy"]
            regular = [line for line in lines if not line["bold"]]
            if regular and "Bold" in (style["font"] or ""):
                body = next(c for c in regular[0]["chars"] if c["obj"])
                style = {**self._style_of(body), "matrix": style["matrix"], "obj_size": style["obj_size"]}
        else:
            if x is None or y is None:
                raise PdfEditError("insert_text needs an anchor or x and y")
            height = page.get_height()
            body = next((c for line in lines for c in line["chars"] if c["obj"] and not line["bold"]), None)
            style = self._style_of(body) if body else {"font_handle": None, "font": "Helvetica", "flags": 0, "weight": 400, "obj_size": size or 11, "matrix": (1, 0, 0, 1), "color": (0, 0, 0, 255), "render_mode": 0}
            if size:
                style = {**style, "obj_size": float(size), "matrix": (1, 0, 0, 1)}
            # y is the top of the text, as the outline reports lines; the baseline sits below it.
            draw_x, draw_y = float(x), height - float(y) - style["obj_size"] * abs(style["matrix"][3] or 1) * 0.8
        self._draw_run(page, text, style, draw_x, draw_y)
        raw.FPDFPage_GenerateContent(page.raw)
        self.dirty_pages.add(page_no)
        return 1

    def save(self, output):
        self.pdf.save(str(output))


def _norm_index(text, needle):
    """Index in text where the whitespace-normalised needle starts."""
    pattern = r"\s+".join(re.escape(part) for part in needle.split(" "))
    match = re.search(pattern, text)
    return match.start() if match else 0


def _replace_runs(runs, new_text):
    """Whole line replaced: the line's first style draws it."""
    return [(new_text, runs[0][1])] if runs else []


def _replace_in_runs(runs, target, value, replace_all=True):
    """Replace target in the concatenated run text; the replacement takes the style where it starts."""
    text = "".join(text for text, _ in runs)
    styles = []
    for run_text, style in runs:
        styles.extend([style] * len(run_text))
    pattern = r"\s+".join(re.escape(part) for part in target.split(" "))
    out_chars = []
    out_styles = []
    position = 0
    for match in re.finditer(pattern, text):
        out_chars.extend(text[position:match.start()])
        out_styles.extend(styles[position:match.start()])
        style = styles[match.start()] if match.start() < len(styles) else styles[-1]
        out_chars.extend(value)
        out_styles.extend([style] * len(value))
        position = match.end()
        if not replace_all:
            break
    out_chars.extend(text[position:])
    out_styles.extend(styles[position:])
    merged = []
    for ch, style in zip(out_chars, out_styles):
        if merged and merged[-1][1] is style:
            merged[-1][0].append(ch)
        else:
            merged.append(([ch], style))
    return [("".join(chars), style) for chars, style in merged if chars]


def _wrap(text, measure, width):
    lines = []
    for paragraph in str(text).split("\n"):
        words = paragraph.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if not current or measure(candidate) <= width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines or [""]


def fill_fields(path, output, values):
    reader = PdfReader(str(path))
    writer = PdfWriter(clone_from=reader)
    fields = reader.get_fields() or {}
    filled = []
    missing = []
    normalized = {}
    for name, value in values.items():
        if name in fields:
            normalized[name] = value
            continue
        match = next((key for key in fields if key.lower() == str(name).lower() or str(fields[key].get("/TU") or "").lower() == str(name).lower()), None)
        if match:
            normalized[match] = value
        else:
            missing.append(name)
    for name, value in normalized.items():
        field = fields[name]
        if field.get("/FT") == "/Btn":
            states = [str(state) for state in (field.get("/_States_") or []) if str(state) != "/Off"]
            on = states[0] if states else "/Yes"
            truthy = str(value).strip().lower() in ("1", "true", "yes", "y", "on", "x", "checked", on.lstrip("/").lower())
            normalized[name] = on if truthy else "/Off"
        else:
            normalized[name] = str(value)
        filled.append(name)
    for page in writer.pages:
        if "/Annots" in page:
            writer.update_page_form_field_values(page, {k: v for k, v in normalized.items()}, auto_regenerate=False)
    writer.set_need_appearances_writer(True)
    with open(output, "wb") as handle:
        writer.write(handle)
    return filled, missing


def apply_operations(source, output, operations):
    """Apply edit operations; returns (applied_count, warnings)."""
    source = Path(source)
    output = Path(output)
    warnings = []
    applied = 0
    field_values = {}
    text_ops = []
    for op in operations[:200]:
        if not isinstance(op, dict):
            continue
        kind = str(op.get("type") or op.get("op") or "")
        if kind == "fill_field" and op.get("name"):
            field_values[str(op["name"])] = op.get("value", "")
        elif kind in ("replace_text", "delete_text", "rewrite_lines", "insert_text"):
            text_ops.append((kind, op))
    current = source
    if field_values:
        filled_path = output.with_name(output.stem + ".fields.pdf")
        filled, missing = fill_fields(current, filled_path, field_values)
        applied += len(filled)
        warnings.extend(f"form field not found: {name}" for name in missing[:10])
        current = filled_path
    if text_ops:
        editor = Editor(current)
        try:
            for kind, op in text_ops:
                try:
                    page = int(op["page"]) if op.get("page") not in (None, "") else None
                    if kind in ("replace_text", "delete_text"):
                        find = str(op.get("find") or "")
                        count = editor.replace_text(find, "" if kind == "delete_text" else str(op.get("replace") or ""), page=page, line_id=op.get("line"), replace_all=op.get("all", True) is not False)
                        if not count:
                            warnings.append(f"text not found: {find[:60]}")
                        applied += 1 if count else 0
                    elif kind == "rewrite_lines":
                        ids = [str(item) for item in (op.get("lines") or [])][:40]
                        applied += 1 if editor.rewrite_lines(ids, str(op.get("text") or "")) else 0
                    elif kind == "insert_text":
                        applied += editor.insert_text(str(op.get("text") or ""), page or 1, anchor=op.get("anchor"), position=str(op.get("position") or "right"),
                                                      x=op.get("x"), y=op.get("y"), size=op.get("size"), line_id=op.get("line"))
                except PdfEditError as exc:
                    warnings.append(str(exc)[:200])
            warnings.extend(editor.warnings)
            editor.save(output)
        finally:
            editor.close()
    elif current != output:
        os.replace(current, output)
    if current != source and current != output and Path(current).exists():
        Path(current).unlink()
    if not applied:
        raise PdfEditError("no_edits_applied: " + "; ".join(warnings[:4]))
    return applied, warnings
