"""Document ingestion: every document becomes pages (PDF, Word, PowerPoint) or rows (Excel, CSV).

A paged document is converted to PDF when needed, and every page keeps two things:
the PDF's own text layer (exact, free) and a rendered image. Pages whose meaning lives in
the picture (scans, figures, charts, ruled tables, maths, broken text layers) are flagged
`visual`, so the chat shows their image next to their text; every other page goes in as
text only. Spreadsheets keep every row, block by block, with exact row numbers.

Nothing here truncates content: a document is ingested completely or the job fails.
"""

import csv
import os
import re
import shutil
import subprocess
import textwrap
from datetime import date, datetime, time as dt_time

PIPELINE_PAGES = "pages-v1"
PIPELINE_SHEETS = "sheets-v1"
# Raised whenever ingest learns to store more of a document, so the re-ingest script can find
# documents stored by an older worker under the same pipeline name.
# 2: hidden PowerPoint slides, OCR of scanned pages at OCR_DPI.
INGEST_VERSION = 2

# A rows block ends at whichever comes first; a single row larger than this is its own block.
SHEET_BLOCK_ROWS = 200
SHEET_BLOCK_CHARS = 24_000

# What makes a page visual. Tuned on text-heavy reports, slide decks, scans and papers.
VISUAL_IMAGE_COVERAGE = 0.10     # share of the page covered by raster images
VISUAL_PATH_OBJECTS = 25         # vector shapes: charts, diagrams, ruled tables
VISUAL_MATH_CHARS = 6            # maths symbols, which text layers flatten
VISUAL_TABLE_LINES = 6           # lines laid out as 3+ aligned columns
SPARSE_TEXT_CHARS = 80
VISUAL_DIAGRAM_PATHS = 6         # connectors and shapes on a page with little prose
VISUAL_DIAGRAM_CHARS = 1500

# Stored with the document so a chat can describe a document too long to include
# without loading it: each page's first words, and each sheet's first rows.
PAGE_INDEX_CHARS = 90
PREVIEW_ROWS = 10

_MATH = re.compile(r"[\u2200-\u22FF\u2A00-\u2AFF\u27C0-\u27EF\u0391-\u03A9\u03B1-\u03C9\U0001D400-\U0001D7FF\u2190-\u21FF]")
_GARBLED = re.compile(r"[\uE000-\uF8FF\uFFFD]")
_TABLE_GAP = re.compile(r"\S {3,}(?=\S)")


def estimate_tokens(text):
    return (len(text or "") + 3) // 4


def tidy_page_text(text):
    """Strip margins and runs of blank lines; keep the words exactly."""
    lines = [line.rstrip() for line in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    out = []
    blank = 0
    for line in lines:
        if line.strip():
            blank = 0
            out.append(line)
        else:
            blank += 1
            if blank == 1 and out:
                out.append("")
    return textwrap.dedent("\n".join(out)).strip()


def split_pdftotext_pages(raw, page_count):
    """pdftotext separates pages with form feeds; pad or trim to the real page count."""
    pages = str(raw or "").split("\f")
    if len(pages) > page_count and not "".join(pages[page_count:]).strip():
        pages = pages[:page_count]
    if len(pages) != page_count:
        return None
    return pages


def run_pdftotext(pdf_path, page_count, layout=False, timeout=180):
    cmd = ["pdftotext", "-enc", "UTF-8", "-eol", "unix"]
    if layout:
        cmd.append("-layout")
    cmd.extend([str(pdf_path), "-"])
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    return split_pdftotext_pages(result.stdout.decode("utf-8", errors="replace"), page_count)


def tabular_line_count(layout_text):
    """Lines that pdftotext -layout prints as three or more aligned columns."""
    return sum(1 for line in str(layout_text or "").split("\n") if len(_TABLE_GAP.findall(line)) >= 2)


def visual_reason(text, stats=None, layout_text=""):
    """Why a page needs its image in front of the model, or "" when its text says it all."""
    stats = stats or {}
    compact = re.sub(r"\s+", "", text or "")
    chars = len(compact)
    images = float(stats.get("image_coverage") or 0)
    paths = int(stats.get("path_objects") or 0)
    objects = int(stats.get("objects") or 0)
    if images >= VISUAL_IMAGE_COVERAGE:
        return "image"
    if paths >= VISUAL_PATH_OBJECTS:
        return "graphics"
    # A diagram: a few connectors or shapes on a page that isn't mostly prose.
    if paths >= VISUAL_DIAGRAM_PATHS and chars < VISUAL_DIAGRAM_CHARS:
        return "graphics"
    if chars == 0:
        return "no_text" if objects else ""
    if "(cid:" in (text or "") or len(_GARBLED.findall(compact)) >= max(3, chars * 0.05):
        return "garbled_text"
    math = len(_MATH.findall(compact))
    if math >= VISUAL_MATH_CHARS or (chars < 400 and math >= 3):
        return "math"
    rows = tabular_line_count(layout_text)
    nonblank = sum(1 for line in str(layout_text or "").split("\n") if line.strip())
    if rows >= VISUAL_TABLE_LINES and nonblank and rows / nonblank >= 0.25:
        return "table"
    if chars < SPARSE_TEXT_CHARS and (images > 0.01 or paths >= 5):
        return "sparse_graphic"
    return ""


def page_index_entry(number, label, text, visual):
    return {"page": number, "label": label, "start": re.sub(r"\s+", " ", text or "").strip()[:PAGE_INDEX_CHARS], "visual": bool(visual)}


def pdf_page_stats(pdf_path):
    """Per page: size in points and how much of it is pictures or vector graphics."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    try:
        pdf = pdfium.PdfDocument(str(pdf_path))
    except pdfium.PdfiumError as exc:
        if "password" in str(exc).lower():
            raise RuntimeError("password_protected") from exc
        raise RuntimeError(f"pdf_unreadable: {exc}") from exc
    stats = []
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            try:
                width, height = page.get_size()
                area = max(1.0, float(width) * float(height))
                image_area = 0.0
                paths = 0
                objects = 0
                for obj in page.get_objects(max_depth=4):
                    objects += 1
                    kind = getattr(obj, "type", None)
                    if kind == pdfium_c.FPDF_PAGEOBJ_IMAGE:
                        try:
                            left, bottom, right, top = obj.get_bounds()
                            w = max(0.0, min(right, width) - max(left, 0.0))
                            h = max(0.0, min(top, height) - max(bottom, 0.0))
                            image_area += w * h
                        except Exception:
                            image_area += area * 0.05
                    elif kind in (pdfium_c.FPDF_PAGEOBJ_PATH, pdfium_c.FPDF_PAGEOBJ_SHADING):
                        paths += 1
                stats.append({
                    "width_pt": float(width),
                    "height_pt": float(height),
                    "image_coverage": min(1.0, image_area / area),
                    "path_objects": paths,
                    "objects": objects,
                })
            finally:
                page.close()
    finally:
        pdf.close()
    return stats


def pdfium_page_texts(pdf_path):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    texts = []
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            textpage = page.get_textpage()
            try:
                texts.append(textpage.get_text_range())
            finally:
                textpage.close()
                page.close()
    finally:
        pdf.close()
    return texts


def read_pdf_pages(pdf_path, max_pages):
    """Text, layout text and drawing stats for every page, or an error naming the limit."""
    stats = pdf_page_stats(pdf_path)
    page_count = len(stats)
    if page_count == 0:
        raise RuntimeError("empty_document: the file has no pages")
    if page_count > max_pages:
        raise RuntimeError(f"too_many_pages: the document has {page_count} pages; the limit is {max_pages}")
    try:
        texts = run_pdftotext(pdf_path, page_count)
    except Exception:
        texts = None
    if texts is None:
        texts = pdfium_page_texts(pdf_path)
    try:
        layouts = run_pdftotext(pdf_path, page_count, layout=True) or [""] * page_count
    except Exception:
        layouts = [""] * page_count
    pages = []
    for index in range(page_count):
        text = tidy_page_text(texts[index] if index < len(texts) else "")
        reason = visual_reason(text, stats[index], layouts[index] if index < len(layouts) else "")
        pages.append({
            "number": index + 1,
            "text": text,
            "visual": bool(reason),
            "visual_reason": reason,
            **stats[index],
        })
    return pages


# ---- OCR --------------------------------------------------------------------------------

OCR_REASONS = ("image", "no_text", "garbled_text")
OCR_MAX_TEXT_CHARS = 40


def needs_ocr(page):
    """A scanned page (or one whose text layer is broken) has no text to search: read it by OCR."""
    if page.get("visual_reason") == "garbled_text":
        return True
    compact = re.sub(r"\s+", "", page.get("text") or "")
    return page.get("visual_reason") in OCR_REASONS and len(compact) < OCR_MAX_TEXT_CHARS


def ocr_available():
    return shutil.which("tesseract") is not None


# Model page images are rendered small to save tokens; OCR reads small print badly at that
# size, so scanned pages are rendered again for OCR alone, in grey, at OCR_DPI, or at the
# scan's own resolution when that is lower: upscaling a scan only makes Tesseract split
# digits ("12417" read as "1241 7"). Kept between OCR_MIN_DPI and OCR_DPI.
OCR_DPI = 144
OCR_MIN_DPI = 72


def page_scan_ppi(pdf_path, timeout=60):
    """Each page's highest embedded-image resolution, from `pdfimages -list`: {page: ppi}."""
    try:
        result = subprocess.run(
            ["pdfimages", "-list", str(pdf_path)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError):
        return {}
    found = {}
    for line in result.stdout.decode("utf-8", "replace").splitlines()[2:]:
        parts = line.split()
        if len(parts) < 14 or not parts[0].isdigit():
            continue
        try:
            page, ppi = int(parts[0]), min(int(parts[12]), int(parts[13]))
        except ValueError:
            continue
        found[page] = max(found.get(page, 0), ppi)
    return found


def ocr_dpi_for(scan_ppi, max_dpi=OCR_DPI):
    """OCR resolution for a page: its scan's resolution within [OCR_MIN_DPI, max_dpi]."""
    if not scan_ppi:
        return max_dpi
    return max(OCR_MIN_DPI, min(int(scan_ppi), max_dpi))


def ocr_render_command(pdf_path, prefix, page_number, dpi):
    return [
        "pdftoppm", "-gray", "-png", "-r", str(max(OCR_MIN_DPI, min(int(dpi or OCR_DPI), 400))),
        "-f", str(int(page_number)), "-l", str(int(page_number)), "-singlefile",
        str(pdf_path), str(prefix),
    ]


def ocr_image(image_path, dpi, timeout=90):
    """Text of one page image, read by Tesseract: "" when it finds none, None when OCR fails."""
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    try:
        result = subprocess.run(
            ["tesseract", str(image_path), "-", "--dpi", str(int(dpi)), "--psm", "3", "-l", "eng"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, env=env,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    return tidy_page_text(result.stdout.decode("utf-8", "replace"))


def ocr_pdf_page(pdf_path, page_number, out_dir, dpi=OCR_DPI, timeout=120):
    """Render one PDF page at OCR resolution and read it. None when rendering or OCR fails."""
    prefix = os.path.join(str(out_dir), f"ocr-{int(page_number):04d}")
    try:
        subprocess.run(
            ocr_render_command(pdf_path, prefix, page_number, dpi),
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    image = f"{prefix}.png"
    try:
        return ocr_image(image, dpi, timeout=timeout)
    finally:
        try:
            os.remove(image)
        except OSError:
            pass


def pptx_slides(path, notes_text=None):
    """Each slide in order: its number, whether it is hidden, and its speaker notes."""
    from pptx import Presentation

    prs = Presentation(str(path))
    slides = []
    for number, slide in enumerate(prs.slides, start=1):
        hidden = str(slide._element.get("show", "1")).lower() in ("0", "false")
        notes = notes_text(slide) if notes_text else ""
        slides.append({"number": number, "hidden": hidden, "notes": notes})
    return slides


def unhide_slides(source, target):
    """A copy of the deck with every slide shown, so the PDF has a page for each slide.

    LibreOffice leaves hidden slides out of the PDF, and their text and notes would be lost.
    Returns False (and writes nothing) when the deck has no hidden slides.
    """
    from pptx import Presentation

    prs = Presentation(str(source))
    hidden = [slide for slide in prs.slides if str(slide._element.get("show", "1")).lower() in ("0", "false")]
    if not hidden:
        return False
    for slide in hidden:
        del slide._element.attrib["show"]
    prs.save(str(target))
    return True


def map_slides_to_pages(slides, page_count):
    """PDF page -> slide. Every slide has a page once hidden ones are shown for conversion;
    a PDF made from the deck as-is (hidden slides left out) maps onto the visible ones."""
    if len(slides) == page_count:
        return slides
    visible = [slide for slide in slides if not slide["hidden"]]
    if len(visible) == page_count:
        return visible
    return [None] * page_count


def slide_label(slide, number):
    if not slide:
        return f"Slide {number}"
    return f"Slide {slide['number']}{' (hidden in the presentation)' if slide.get('hidden') else ''}"


# ---- Spreadsheets ---------------------------------------------------------------------

def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 1e15:
            return str(int(value))
        return repr(value)
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == dt_time(0, 0) else value.isoformat(sep=" ")
    if isinstance(value, (date, dt_time)):
        return value.isoformat()
    text = str(value)
    return text.replace("\t", " ").replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def row_line(cells):
    values = list(cells)
    while values and values[-1] == "":
        values.pop()
    return "\t".join(values)


def column_letter(index):
    letters = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


class SheetBlocks:
    """Collects one sheet's rows into blocks of whole rows."""

    def __init__(self, sheet, sheet_state="visible"):
        self.sheet = sheet
        self.sheet_state = sheet_state
        self.blocks = []
        self.lines = []
        self.rows = []
        self.chars = 0
        self.max_columns = 0
        self.row_count = 0
        self.header = None
        self.header_row = None
        self.preview = []

    def add(self, row_number, cells):
        line = row_line(cells)
        if not line.strip():
            return
        columns = len(line.split("\t"))
        self.max_columns = max(self.max_columns, columns)
        self.row_count += 1
        if self.header is None and columns >= 2:
            self.header = [cell[:80] for cell in line.split("\t")[:60]]
            self.header_row = row_number
        if len(self.preview) < PREVIEW_ROWS:
            self.preview.append({"row": row_number, "cells": line[:400]})
        if self.rows and (len(self.rows) >= SHEET_BLOCK_ROWS or self.chars + len(line) + 1 > SHEET_BLOCK_CHARS):
            self.flush()
        self.lines.append(line)
        self.rows.append(row_number)
        self.chars += len(line) + 1

    def flush(self):
        if not self.rows:
            return
        self.blocks.append({"lines": self.lines, "rows": self.rows})
        self.lines = []
        self.rows = []
        self.chars = 0

    def finish(self):
        self.flush()
        return self

    def summary(self):
        return {
            "name": self.sheet,
            "state": self.sheet_state,
            "rows": self.row_count,
            "columns": self.max_columns,
            "last_row": self.blocks[-1]["rows"][-1] if self.blocks else 0,
            "header_row": self.header_row,
            "header": self.header or [],
            "preview": self.preview,
        }


def read_xlsx_sheets(path, max_sheets, max_cells):
    """Every non-empty row of every sheet; formulas show as `=FORMULA => cached value`."""
    from openpyxl import load_workbook

    formulas = load_workbook(str(path), read_only=True, data_only=False)
    values = load_workbook(str(path), read_only=True, data_only=True)
    try:
        if len(formulas.worksheets) > max_sheets:
            raise RuntimeError(f"too_many_sheets: the workbook has {len(formulas.worksheets)} sheets; the limit is {max_sheets}")
        calculation = getattr(formulas, "calculation", None)
        stale_cache = bool(getattr(calculation, "fullCalcOnLoad", False) or getattr(calculation, "forceFullCalc", False))
        used_cells = 0
        sheets = []
        for sheet in formulas.worksheets:
            value_sheet = values[sheet.title]
            # Read the rows actually stored, not a declared used range that can claim a million
            # empty rows; gaps between stored rows still come through, so numbering stays exact.
            for ws in (sheet, value_sheet):
                if hasattr(ws, "reset_dimensions"):
                    ws.reset_dimensions()
            blocks = SheetBlocks(sheet.title, getattr(sheet, "sheet_state", "visible") or "visible")
            for row_number, (formula_row, value_row) in enumerate(
                zip(sheet.iter_rows(), value_sheet.iter_rows()), start=1
            ):
                cells = []
                for formula_cell, value_cell in zip(formula_row, value_row):
                    raw = formula_cell.value
                    if raw is None:
                        cells.append("")
                        continue
                    used_cells += 1
                    if used_cells > max_cells:
                        raise RuntimeError(f"too_many_cells: the workbook has more than {max_cells} filled cells")
                    if isinstance(raw, str) and raw.startswith("="):
                        cached = value_cell.value
                        formula = cell_text(raw)
                        cells.append(formula if stale_cache or cached is None else f"{formula} => {cell_text(cached)}")
                    else:
                        cells.append(cell_text(raw))
                blocks.add(row_number, cells)
            sheets.append(blocks.finish())
        return sheets, {"used_cell_count": used_cells, "formula_cache_trusted": not stale_cache}
    finally:
        formulas.close()
        values.close()


def read_delimited_sheet(path, kind, max_rows, max_columns, detect_encoding=None):
    encoding = (detect_encoding(path) if detect_encoding else None) or "utf-8"
    delimiter = "\t" if kind == "tsv" else ","
    blocks = SheetBlocks("Sheet1")
    used_cells = 0
    with open(path, "r", encoding=encoding, errors="replace", newline="") as handle:
        for row_number, row in enumerate(csv.reader(handle, delimiter=delimiter), start=1):
            if row_number > max_rows:
                raise RuntimeError(f"too_many_rows: the file has more than {max_rows} rows")
            if len(row) > max_columns:
                raise RuntimeError(f"too_many_columns: row {row_number} has {len(row)} columns; the limit is {max_columns}")
            cells = [cell_text(cell) for cell in row]
            used_cells += sum(1 for cell in cells if cell)
            blocks.add(row_number, cells)
    return [blocks.finish()], {"used_cell_count": used_cells}


def sheet_chunks(sheets, make_chunk):
    """Rows blocks as chunk rows, in sheet order."""
    chunks = []
    for sheet in sheets:
        for block in sheet.blocks:
            first, last = block["rows"][0], block["rows"][-1]
            last_column = column_letter(max(1, sheet.max_columns))
            cell_range = f"A{first}:{last_column}{last}"
            chunks.append(make_chunk(
                len(chunks),
                "sheet_range",
                f"{sheet.sheet} — rows {first}-{last}",
                "\n".join(block["lines"]),
                {
                    "sheet": sheet.sheet,
                    "range": cell_range,
                    "row_start": first,
                    "row_end": last,
                    "row_numbers": block["rows"],
                    "column_start": 1,
                    "column_end": max(1, sheet.max_columns),
                    "header_row": sheet.header_row,
                    "header_repeated": False,
                    "sheet_state": sheet.sheet_state,
                    "extractor": PIPELINE_SHEETS,
                },
            ))
    return chunks
