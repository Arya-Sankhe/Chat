"""Turn raw speech segments into transcript lines (for the player) and chunks (for search).

Pure functions only, so they are cheap to test without a model.
"""

import re

SENTENCE_END = re.compile(r"[.?!…][\"')\]]*$")
# A line keeps growing until it is long enough to read comfortably, then breaks at a
# sentence end; very long monologues still break so "tap a line to jump" stays useful.
LINE_MIN_SECONDS = 12.0
LINE_MAX_SECONDS = 32.0
LINE_MAX_GAP_SECONDS = 2.5
CHUNK_MAX_CHARS = 4000


def clean_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def format_clock(seconds):
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _capitalize(text):
    for index, char in enumerate(text):
        if char.isalpha():
            return text[:index] + char.upper() + text[index + 1:]
    return text


def build_lines(segments):
    """Merge short VAD segments into readable lines of [start, end, text]."""
    lines = []
    current = None
    for segment in segments:
        text = clean_text(segment.get("text"))
        if not text:
            continue
        start, end = float(segment["start"]), float(segment["end"])
        if current is not None:
            span = current["end"] - current["start"]
            gap = start - current["end"]
            ended = bool(SENTENCE_END.search(current["text"]))
            if gap <= LINE_MAX_GAP_SECONDS and span < LINE_MAX_SECONDS and (span < LINE_MIN_SECONDS or not ended):
                current["text"] = f"{current['text']} {text}"
                current["end"] = end
                continue
            lines.append(current)
        current = {"start": start, "end": end, "text": text}
    if current is not None:
        lines.append(current)

    # VAD cuts mid-sentence, so a line can start lowercase; fix it when the previous
    # line finished a sentence (or there is none).
    previous_ended = True
    for line in lines:
        if previous_ended:
            line["text"] = _capitalize(line["text"])
        previous_ended = bool(SENTENCE_END.search(line["text"]))
    return [[round(line["start"], 2), round(line["end"], 2), line["text"]] for line in lines]


def build_chunks(lines, max_chars=CHUNK_MAX_CHARS):
    """Group lines into search chunks labelled by time range, with a [m:ss] marker per line
    so answers can point the student back to the moment in the lecture."""
    chunks = []
    parts, start, end, size = [], None, None, 0
    for line_start, line_end, text in lines:
        piece = f"[{format_clock(line_start)}] {text}"
        if parts and size + len(piece) + 1 > max_chars:
            chunks.append(_chunk(parts, start, end))
            parts, start, size = [], None, 0
        if start is None:
            start = line_start
        parts.append(piece)
        end = line_end
        size += len(piece) + 1
    if parts:
        chunks.append(_chunk(parts, start, end))
    return chunks


def _chunk(parts, start, end):
    return {
        "text": "\n".join(parts),
        "label": f"{format_clock(start)}–{format_clock(end)}",
        "start": round(start, 2),
        "end": round(end, 2),
    }


def word_count(lines):
    return sum(len(text.split()) for _, _, text in lines)
