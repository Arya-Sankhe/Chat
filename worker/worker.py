import base64
import csv
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
import boto3
import requests
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from charset_normalizer import from_path
from docx import Document
from docx.shared import Inches as DocxInches
from openpyxl import load_workbook
from openpyxl.utils.cell import get_column_letter, range_boundaries
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches as PptxInches
from pptx.util import Pt

try:
    from worker import docx_edit, ingest, pdf_edit
    from worker.xlsx_generator import create_xlsx_workbook, validate_formula
except ImportError:  # running as a loose script rather than the worker package
    import docx_edit
    import ingest
    import pdf_edit
    from xlsx_generator import create_xlsx_workbook, validate_formula


def env(name, default=""):
    return os.environ.get(name, default).strip()


def env_int(name, default, minimum=None, maximum=None):
    raw = env(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = int(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def env_float(name, default, minimum=None, maximum=None):
    raw = env(name, str(default))
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = float(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def default_lease_heartbeat_seconds(lease_seconds):
    lease = max(1, int(lease_seconds or 1))
    return max(5.0, min(float(lease) / 3.0, 30.0))


def idle_sleep_seconds(empty_claims, max_idle_seconds, slot_offset, now):
    ramp = (1.0, 2.0, 5.0)
    index = max(1, empty_claims) - 1
    if index < len(ramp) and ramp[index] < max_idle_seconds:
        return ramp[index]
    # Steady state wakes on a shared clock grid so sibling loops keep their slots
    # apart forever, instead of drifting into lockstep after each job.
    return (slot_offset - now) % max_idle_seconds or max_idle_seconds


def worker_idle_offset_seconds(index, concurrency, max_idle_seconds):
    return 0.0 if concurrency <= 1 else float(index) * float(max_idle_seconds) / float(concurrency)


def is_retryable_http_status(status_code):
    try:
        code = int(status_code)
    except (TypeError, ValueError):
        return False
    return code == 429 or code >= 500


def retry_sleep_seconds(attempt, base=0.5, cap=20.0):
    delay = min(cap, base * (2 ** max(0, attempt)))
    return delay * (0.5 + random.random())


STORAGE_BUSY_CODES = {"ServiceUnavailable", "SlowDown", "TooManyRequests", "RequestTimeout", "InternalError", "503", "429", "500"}


def is_storage_busy_error(exc):
    """R2 throttles concurrent reads of one object (a fresh file is often read by
    ingest and preview at once); those errors clear within seconds."""
    if not isinstance(exc, ClientError):
        return False
    error = exc.response.get("Error", {}) if isinstance(exc.response, dict) else {}
    status = (exc.response.get("ResponseMetadata", {}) if isinstance(exc.response, dict) else {}).get("HTTPStatusCode")
    return str(error.get("Code", "")) in STORAGE_BUSY_CODES or is_retryable_http_status(status)


def with_storage_retries(action, *, attempts=6, sleep=None):
    sleep = sleep or time.sleep
    for attempt in range(attempts):
        try:
            return action()
        except ClientError as exc:
            if attempt + 1 >= attempts or not is_storage_busy_error(exc):
                raise
            sleep(retry_sleep_seconds(attempt, base=1.0, cap=10.0))


def request_with_retries(method, url, *, max_attempts=3, timeout=30, retry_statuses=True, **kwargs):
    attempts = max(1, int(max_attempts))
    last_error = None
    for attempt in range(attempts):
        try:
            response = requests.request(method, url, timeout=timeout, **kwargs)
            if (
                retry_statuses
                and not response.ok
                and is_retryable_http_status(response.status_code)
                and attempt + 1 < attempts
            ):
                time.sleep(retry_sleep_seconds(attempt))
                continue
            return response
        except requests.exceptions.RequestException as exc:
            last_error = exc
            if attempt + 1 >= attempts:
                raise
            time.sleep(retry_sleep_seconds(attempt))
    if last_error:
        raise last_error
    raise RuntimeError(f"request failed without response: {method} {url}")


def split_page_ranges(page_count, worker_count):
    total = max(0, int(page_count or 0))
    workers = max(1, int(worker_count or 1))
    if total <= 0:
        return []
    if workers <= 1 or total < workers * 2:
        return [(1, total)]
    workers = min(workers, total)
    base, rem = divmod(total, workers)
    ranges = []
    start = 1
    for index in range(workers):
        size = base + (1 if index < rem else 0)
        end = start + size - 1
        ranges.append((start, end))
        start = end + 1
    return ranges


NODE_ARTIFACT_GENERATOR = env("DOCUMENT_ARTIFACT_GENERATOR", str(Path(__file__).resolve().parent / "artifact_generator.mjs"))
NODE_BIN = env("DOCUMENT_NODE_BIN", "node")
USE_JS_ARTIFACT_GENERATOR = env("DOCUMENT_USE_JS_ARTIFACT_GENERATOR", "1").lower() not in ("0", "false", "no")
HTTP_MAX_ATTEMPTS = env_int("DOCUMENT_HTTP_MAX_ATTEMPTS", 3, minimum=1, maximum=8)
WORKER_CONCURRENCY_CAP = 8
PDF_RENDER_WORKERS_CAP = 4
PAGE_UPLOAD_WORKERS_CAP = 8


class LeaseLostError(RuntimeError):
    pass


class JobCancelledError(RuntimeError):
    def __init__(self, message="job_cancelled"):
        super().__init__(message)
        self.code = "cancelled"


class StorageQuotaError(RuntimeError):
    def __init__(self, message="Storage is full. Delete files to free up space."):
        super().__init__(message)
        self.code = "storage_exhausted"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def pptx_notes_text(slide):
    """Speaker notes body text via notes_text_frame (excludes slide image/number placeholders)."""
    try:
        if not getattr(slide, "has_notes_slide", False):
            return ""
        notes_slide = slide.notes_slide
        frame = getattr(notes_slide, "notes_text_frame", None)
        if frame is None:
            return ""
        return "\n".join(
            p.text.strip() for p in frame.paragraphs if p.text and p.text.strip()
        ).strip()
    except Exception:
        return ""


# Metadata keys ingest writes only sometimes: dropped before a re-ingest stores its own.
INGEST_DERIVED_METADATA = {
    "ocr_pages", "ocr_failed_pages", "hidden_slides_missing", "visual_pages", "page_index",
    "sheets", "error", "stage", "progress", "warnings",
}


def build_pdftoppm_command(path, prefix, dpi, first=None, last=None):
    cmd = [
        "pdftoppm",
        "-jpeg",
        "-jpegopt",
        "quality=85",
        "-r",
        str(max(72, min(int(dpi or 110), 180))),
    ]
    if first is not None and last is not None:
        cmd.extend(["-f", str(int(first)), "-l", str(int(last))])
    cmd.extend([str(path), str(prefix)])
    return cmd


def lease_until_iso(lease_seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=max(30, int(lease_seconds or 30)))).isoformat()


def safe_name(value, fallback="document"):
    base = Path(str(value or fallback)).name
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in base).strip("-")
    return (cleaned or fallback)[:120]


SUPERSCRIPT_MAP = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")",
}
SUBSCRIPT_MAP = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
    "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
    "ᵢ": "i", "ⱼ": "j", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x",
}
SYMBOL_TRANSLATION = str.maketrans({
    "ᵀ": "^T",
    "ᵗ": "^t",
    "−": "-",
    "–": "-",
    "—": "-",
    "×": "*",
    "÷": "/",
    "≤": "<=",
    "≥": ">=",
    "≠": "!=",
    "≈": "~=",
    "∈": "in",
    "∉": "not in",
    "∞": "infinity",
})


def normalize_math_symbols(text):
    value = str(text or "").translate(SYMBOL_TRANSLATION)

    def power(match):
        plain = "".join(SUPERSCRIPT_MAP.get(char, char) for char in match.group(0))
        return f"^{plain}" if len(plain) == 1 and plain.isalnum() else f"^({plain})"

    def subscript(match):
        plain = "".join(SUBSCRIPT_MAP.get(char, char) for char in match.group(0))
        return f"_{plain}" if len(plain) == 1 and plain.isalnum() else f"_({plain})"

    value = re.sub(f"[{re.escape(''.join(SUPERSCRIPT_MAP))}]+", power, value)
    value = re.sub(f"[{re.escape(''.join(SUBSCRIPT_MAP))}]+", subscript, value)
    return value


def clean_markdown(text):
    text = str(text or "")
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    return normalize_math_symbols(text).strip()


def artifact_content(input_data):
    return str(
        input_data.get("content")
        or input_data.get("source_text")
        or input_data.get("data", {}).get("content")
        or input_data.get("data", {}).get("text")
        or input_data.get("data", {}).get("body")
        or ""
    ).strip()


def comparable_heading(text):
    return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())


def strip_duplicate_title_heading(text, title):
    lines = str(text or "").splitlines()
    title_key = comparable_heading(title)
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        heading = re.match(r"^#{1,3}\s+(.+)$", line)
        if heading and comparable_heading(clean_markdown(heading.group(1))) == title_key:
            return "\n".join(lines[:index] + lines[index + 1:]).strip()
        return text
    return text


def split_markdown_table_row(line):
    row = str(line or "").strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    cells = []
    current = []
    escaped = False
    for char in row:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "|":
            cells.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    cells.append("".join(current).strip())
    return cells


def is_markdown_table_separator(line):
    cells = split_markdown_table_row(line)
    return len(cells) >= 2 and all(re.match(r"^:?-{3,}:?$", cell.strip()) for cell in cells)


def normalize_table_row_width(row, width):
    values = [str(value or "").strip() for value in row]
    if width <= 0:
        return values
    if len(values) == width:
        return values
    if len(values) < width:
        return values + [""] * (width - len(values))
    if width == 1:
        return ["|".join(values)]
    if width == 2:
        return [values[0], "|".join(values[1:])]
    return values[: width - 2] + ["|".join(values[width - 2:-1])] + [values[-1]]


def collect_markdown_table(lines, start):
    if start + 1 >= len(lines):
        return None, start
    if "|" not in lines[start] or not is_markdown_table_separator(lines[start + 1]):
        return None, start

    headers = split_markdown_table_row(lines[start])
    width = len(headers)
    rows = []
    index = start + 2
    while index < len(lines):
        line = lines[index].strip()
        if not line or "|" not in line:
            break
        rows.append(normalize_table_row_width(split_markdown_table_row(line), width))
        index += 1

    return {"headers": headers, "rows": rows}, index


class Supabase:
    def __init__(self):
        self.url = env("SUPABASE_URL").rstrip("/")
        self.key = env("SUPABASE_SERVICE_ROLE_KEY")
        self.max_attempts = HTTP_MAX_ATTEMPTS
        if not self.url or not self.key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    def _headers(self, prefer=None):
        headers = {
            "apikey": self.key,
            "authorization": f"Bearer {self.key}",
            "content-type": "application/json",
        }
        if prefer:
            headers["prefer"] = prefer
        return headers

    def request(self, path, method="GET", params=None, body=None, prefer=None, retryable=None):
        can_retry = method.upper() in ("GET", "PATCH", "PUT", "DELETE") if retryable is None else bool(retryable)
        response = request_with_retries(
            method,
            f"{self.url}/rest/v1/{path}",
            max_attempts=self.max_attempts if can_retry else 1,
            timeout=30,
            headers=self._headers(prefer),
            params={k: v for k, v in (params or {}).items() if v is not None and v != ""},
            data=json.dumps(body) if body is not None else None,
        )
        if not response.ok:
            text = response.text
            if "account_storage_limit_exceeded" in text or "pending_storage_limit_exceeded" in text:
                raise StorageQuotaError()
            raise RuntimeError(f"Supabase {method} {path} failed: {response.status_code} {text}")
        if response.status_code == 204 or not response.text:
            return None
        return response.json()

    def rpc(self, name, body):
        return self.request(f"rpc/{name}", method="POST", body=body)

    def claim_job(self, worker_id, lease_seconds, queue):
        rows = self.rpc("klui_claim_document_job", {
            "p_worker_id": worker_id,
            "p_lease_seconds": lease_seconds,
            "p_queue": queue,
        })
        return rows[0] if rows else None

    def complete_document_job(self, job_id, worker_id, output=None, document_patch=None):
        return self.rpc("klui_complete_document_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_output": output if output is not None else {},
            "p_document_patch": document_patch if document_patch is not None else {},
        })

    def fail_document_job(self, job_id, worker_id, error):
        return self.rpc("klui_fail_document_job", {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_error": error if error is not None else {"code": "worker_error", "message": "Document processing failed."},
        })

    def get_job(self, job_id):
        rows = self.request("document_jobs", params={"id": f"eq.{job_id}", "select": "*", "limit": "1"})
        return rows[0] if rows else None

    def get_attachment(self, attachment_id):
        rows = self.request("attachments", params={"id": f"eq.{attachment_id}", "select": "*", "limit": "1"})
        return rows[0] if rows else None

    def get_document_file(self, document_file_id):
        rows = self.request("document_files", params={"id": f"eq.{document_file_id}", "select": "*", "limit": "1"})
        return rows[0] if rows else None

    def update_document_file(self, document_file_id, patch):
        rows = self.request(
            "document_files",
            method="PATCH",
            params={"id": f"eq.{document_file_id}"},
            body={**patch, "updated_at": now_iso()},
            prefer="return=representation",
        )
        return rows[0] if rows else None

    def create_attachment(self, payload):
        rows = self.request("attachments", method="POST", body=payload, prefer="return=representation")
        return rows[0]

    def reserve_attachment(self, payload):
        return self.rpc("klui_reserve_attachment", {
            "p_user_id": payload["user_id"],
            "p_max_bytes": payload["max_bytes"],
            "p_category": payload["category"],
            "p_object_key": payload["object_key"],
            "p_file_name": payload["file_name"],
            "p_content_type": payload["content_type"],
            "p_size_bytes": payload["size_bytes"],
            "p_conversation_id": payload.get("conversation_id"),
            "p_message_id": payload.get("message_id"),
            "p_project_id": payload.get("project_id"),
        })

    def complete_reserved_attachment(self, payload):
        return self.rpc("klui_complete_attachment", {
            "p_user_id": payload["user_id"],
            "p_attachment_id": payload["attachment_id"],
            "p_size_bytes": payload["size_bytes"],
            "p_etag": payload.get("etag"),
            "p_max_bytes": payload["max_bytes"],
        })

    def delete_attachment(self, user_id, attachment_id):
        self.request(
            "attachments",
            method="DELETE",
            params={"id": f"eq.{attachment_id}", "user_id": f"eq.{user_id}"},
            prefer="return=minimal",
        )

    def create_document_file(self, payload):
        rows = self.request("document_files", method="POST", body=payload, prefer="return=representation")
        return rows[0]

    def delete_chunks(self, document_file_id):
        self.request(
            "document_chunks",
            method="DELETE",
            params={"document_file_id": f"eq.{document_file_id}"},
            prefer="return=minimal",
        )

    def delete_pages(self, document_file_id):
        self.request(
            "document_pages",
            method="DELETE",
            params={"document_file_id": f"eq.{document_file_id}"},
            prefer="return=minimal",
        )

    def insert_chunks(self, chunks):
        if not chunks:
            return
        for i in range(0, len(chunks), 250):
            self.request(
                "document_chunks",
                method="POST",
                params={"on_conflict": "document_file_id,chunk_index"},
                body=chunks[i:i + 250],
                prefer="resolution=merge-duplicates,return=minimal",
                retryable=True,
            )

    def insert_pages(self, pages, on_conflict="merge"):
        if not pages:
            return
        if on_conflict == "ignore":
            prefer = "resolution=ignore-duplicates,return=minimal"
        else:
            prefer = "resolution=merge-duplicates,return=minimal"
        for i in range(0, len(pages), 100):
            self.request(
                "document_pages",
                method="POST",
                params={"on_conflict": "document_file_id,page_number"},
                body=pages[i:i + 100],
                prefer=prefer,
                retryable=True,
            )

    def update_page(self, document_file_id, page_number, patch):
        rows = self.request(
            "document_pages",
            method="PATCH",
            params={
                "document_file_id": f"eq.{document_file_id}",
                "page_number": f"eq.{int(page_number)}",
            },
            body=patch,
            prefer="return=representation",
        )
        return rows[0] if rows else None

    def update_job(self, job_id, patch, worker_id=None):
        params = {"id": f"eq.{job_id}"}
        if worker_id:
            params["worker_id"] = f"eq.{worker_id}"
        rows = self.request(
            "document_jobs",
            method="PATCH",
            params=params,
            body={**patch, "updated_at": now_iso()},
            prefer="return=representation",
        )
        return rows[0] if rows else None

    def renew_job_lease(self, job_id, worker_id, lease_seconds):
        """Extend lease_until only while the job is still running for this worker."""
        rows = self.request(
            "document_jobs",
            method="PATCH",
            params={
                "id": f"eq.{job_id}",
                "worker_id": f"eq.{worker_id}",
                "status": "eq.running",
                "lease_until": f"gte.{now_iso()}",
            },
            body={
                "lease_until": lease_until_iso(lease_seconds),
                "updated_at": now_iso(),
            },
            prefer="return=representation",
        )
        return rows[0] if rows else None


def iter_pptx_paragraphs(shapes):
    """Every paragraph in text boxes, table cells and groups on a slide."""
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_pptx_paragraphs(shape.shapes)
            continue
        if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
            yield from shape.text_frame.paragraphs
        if getattr(shape, "has_table", False) and shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    yield from cell.text_frame.paragraphs


def replace_in_paragraph(paragraph, find, replace):
    """Replace text in a paragraph without touching the formatting of anything outside a match.

    A match that spans runs is written into the run where it starts (taking that run's
    formatting); only the matched characters are removed from the runs it continues into.
    """
    runs = list(paragraph.runs)
    text = "".join(run.text for run in runs)
    if not find or find not in text:
        return 0
    starts = {}
    covered = set()
    position = text.find(find)
    while position >= 0:
        starts[position] = True
        covered.update(range(position, position + len(find)))
        position = text.find(find, position + len(find))
    offset = 0
    for run in runs:
        pieces = []
        for index in range(offset, offset + len(run.text)):
            if index in starts:
                pieces.append(replace)
            elif index not in covered:
                pieces.append(text[index])
        offset += len(run.text)
        new_text = "".join(pieces)
        if new_text != run.text:
            run.text = new_text
    return len(starts)


class R2:
    def __init__(self):
        account_id = env("R2_ACCOUNT_ID")
        endpoint = env("R2_ENDPOINT") or (f"https://{account_id}.r2.cloudflarestorage.com" if account_id else "")
        self.bucket = env("R2_BUCKET")
        if not endpoint or not self.bucket:
            raise RuntimeError("R2 endpoint and bucket are required")
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=env("R2_ACCESS_KEY_ID"),
            aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
            region_name="auto",
            config=BotoConfig(
                retries={"mode": "adaptive", "max_attempts": max(3, HTTP_MAX_ATTEMPTS)},
            ),
        )

    def download(self, key, path):
        with_storage_retries(lambda: self.client.download_file(self.bucket, key, str(path)))

    def upload(self, key, path, content_type):
        with open(path, "rb") as handle:
            response = self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=handle,
                ContentType=content_type,
            )
        return str((response or {}).get("ETag", "")).strip('"')

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)


class Processor:
    def __init__(self, index=0, concurrency=1):
        self.db = Supabase()
        self.r2 = R2()
        self.worker_id = f"document-worker-{uuid.uuid4()}"
        self.artifact_warnings = []
        self.artifact_deck = None
        configured_queue = env("DOCUMENT_QUEUE").lower()
        self.queue = configured_queue if re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", configured_queue) else "local"
        self.lease_seconds = max(30, int(env("DOCUMENT_JOB_TIMEOUT_MS", "120000")) // 1000)
        self.error_backoff_seconds = env_float(
            "DOCUMENT_WORKER_ERROR_BACKOFF_SECONDS", 0.5, minimum=0.1
        )
        self.max_idle_seconds = env_float("DOCUMENT_WORKER_MAX_IDLE_SECONDS", 10.0, minimum=1.0)
        self.idle_slot_offset = worker_idle_offset_seconds(index, concurrency, self.max_idle_seconds)
        self.max_backoff_seconds = float(env("DOCUMENT_WORKER_MAX_BACKOFF_SECONDS", "30"))
        self.heartbeat_seconds = env_float(
            "DOCUMENT_LEASE_HEARTBEAT_SECONDS",
            default_lease_heartbeat_seconds(self.lease_seconds),
            minimum=1.0,
        )
        self.heartbeat_seconds = min(self.heartbeat_seconds, max(1.0, self.lease_seconds / 2.0))
        self._lease_lost = None
        self._active_job_id = None
        self.visual_page_dpi = int(env("DOCUMENT_VISUAL_PAGE_DPI", "110"))
        self.ocr_dpi = env_int("DOCUMENT_OCR_DPI", ingest.OCR_DPI, minimum=ingest.OCR_MIN_DPI, maximum=400)
        self.pdf_render_workers = env_int(
            "DOCUMENT_PDF_RENDER_WORKERS", 2, minimum=1, maximum=PDF_RENDER_WORKERS_CAP
        )
        self.page_upload_workers = env_int(
            "DOCUMENT_PAGE_UPLOAD_WORKERS", 4, minimum=1, maximum=PAGE_UPLOAD_WORKERS_CAP
        )
        self.default_limits = {
            "max_pdf_pages": int(env("DOCUMENT_MAX_PDF_PAGES", "150")),
            "max_xlsx_sheets": int(env("DOCUMENT_MAX_XLSX_SHEETS", "25")),
            "max_xlsx_cells": int(env("DOCUMENT_MAX_XLSX_CELLS", "250000")),
            "max_csv_rows": int(env("DOCUMENT_MAX_CSV_ROWS", "100000")),
            "max_csv_columns": int(env("DOCUMENT_MAX_CSV_COLUMNS", "100")),
        }

    def object_key(self, user_id, file_name):
        return f"users/{user_id}/{uuid.uuid4()}/{safe_name(file_name)}"

    def run(self):
        print(f"{self.worker_id} started queue={self.queue}", flush=True)
        consecutive_failures = 0
        empty_claims = 0
        while True:
            try:
                job = self.db.claim_job(self.worker_id, self.lease_seconds, self.queue)
                consecutive_failures = 0
                if not job:
                    empty_claims += 1
                    time.sleep(
                        idle_sleep_seconds(
                            empty_claims,
                            self.max_idle_seconds,
                            self.idle_slot_offset,
                            time.monotonic(),
                        )
                    )
                    continue
                empty_claims = 0
                self.handle_job(job)
            except Exception as exc:
                consecutive_failures += 1
                sleep_for = min(
                    self.max_backoff_seconds,
                    self.error_backoff_seconds * (2 ** min(consecutive_failures - 1, 5)),
                )
                print(
                    f"worker loop error ({type(exc).__name__}); retrying in {sleep_for:.1f}s: {exc}",
                    flush=True,
                )
                time.sleep(sleep_for)

    def _lease_heartbeat_loop(self, job_id, stop_event, lost_event):
        last_renewed = time.monotonic()
        while not stop_event.wait(self.heartbeat_seconds):
            try:
                renewed = self.db.renew_job_lease(job_id, self.worker_id, self.lease_seconds)
                if not renewed:
                    print(f"job {job_id} lease heartbeat skipped (not running for {self.worker_id})", flush=True)
                    lost_event.set()
                    return
                last_renewed = time.monotonic()
            except Exception as exc:
                print(f"job {job_id} lease heartbeat failed: {exc}", flush=True)
                safe_window = max(1.0, self.lease_seconds - self.heartbeat_seconds)
                if time.monotonic() - last_renewed >= safe_window:
                    print(f"job {job_id} stopped before its unrenewed lease could expire", flush=True)
                    lost_event.set()
                    return

    def handle_job(self, job):
        job_id = job["id"]
        tmp = Path(tempfile.mkdtemp(prefix=f"doc-job-{job_id}-"))
        stop_heartbeat = threading.Event()
        lease_lost = threading.Event()
        self._lease_lost = lease_lost
        self._active_job_id = job_id
        heartbeat = threading.Thread(
            target=self._lease_heartbeat_loop,
            args=(job_id, stop_heartbeat, lease_lost),
            name=f"lease-heartbeat-{job_id}",
            daemon=True,
        )
        heartbeat.start()
        try:
            output = self.dispatch(job, tmp)
            self.assert_job_active(job_id)
            document_patch = {}
            if isinstance(output, dict):
                document_patch = output.pop("_document_patch", None) or {}
                public_output = output
            else:
                public_output = output or {}
            completed = self.db.complete_document_job(
                job_id,
                self.worker_id,
                public_output,
                document_patch,
            )
            if completed is None:
                raise LeaseLostError("job_lease_lost")
        except LeaseLostError as exc:
            print(f"job {job_id} stopped after losing its lease: {exc}", flush=True)
        except JobCancelledError as exc:
            error = {"message": str(exc), "code": getattr(exc, "code", "cancelled")}
            failed = self.db.fail_document_job(job_id, self.worker_id, error)
            if failed is None:
                print(f"job {job_id} cancel ignored after losing its lease", flush=True)
            else:
                print(f"job {job_id} cancelled: {exc}", flush=True)
        except Exception as exc:
            error = {"message": str(exc), "code": getattr(exc, "code", "worker_error")}
            failed = self.db.fail_document_job(job_id, self.worker_id, error)
            if failed is None:
                print(f"job {job_id} failure ignored after losing its lease: {exc}", flush=True)
            else:
                print(f"job {job_id} failed: {exc}", flush=True)
        finally:
            stop_heartbeat.set()
            heartbeat.join(timeout=max(1.0, min(self.heartbeat_seconds, 5.0)))
            self._lease_lost = None
            self._active_job_id = None
            shutil.rmtree(tmp, ignore_errors=True)

    def assert_job_lease(self):
        if self._lease_lost is not None and self._lease_lost.is_set():
            raise LeaseLostError("job_lease_lost")

    def assert_job_active(self, job_id=None):
        self.assert_job_lease()
        target_id = job_id or getattr(self, "_active_job_id", None)
        if not target_id:
            return
        current = self.db.get_job(target_id)
        if not current:
            raise LeaseLostError("job_missing")
        if current.get("cancel_requested"):
            raise JobCancelledError("job_cancelled")
        if current.get("status") != "running" or current.get("worker_id") != self.worker_id:
            raise LeaseLostError("job_lease_lost")

    def dispatch(self, job, tmp):
        job_type = job["job_type"]
        if job_type in ("document.enrich.pdf", "document.render_page"):
            return self.legacy_noop_job(job, tmp)
        if job_type.startswith("document.extract."):
            return self.extract_job(job, tmp)
        if job_type.startswith("document.create."):
            return self.create_job(job, tmp)
        if job_type.startswith("document.edit."):
            return self.edit_job(job, tmp)
        if job_type.startswith("document.export."):
            return self.export_job(job, tmp)
        if job_type.startswith("document.outline."):
            return self.outline_job(job, tmp)
        raise RuntimeError(f"Unsupported job type: {job_type}")

    def outline_job(self, job, tmp):
        # The addressable structure of an uploaded file (paragraph / line ids, form fields) that
        # precise edits are written against. Nothing is stored; the outline is the job output.
        source_doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(source_doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        self.r2.download(attachment["object_key"], source)
        if source_doc["kind"] == "docx":
            return {"outline": docx_edit.outline(source)}
        if source_doc["kind"] == "pdf":
            return {"outline": pdf_edit.outline(source)}
        raise RuntimeError("Outlines are available for PDF and Word documents.")

    def extract_job(self, job, tmp):
        """The one job between an upload and a ready document (also used to re-ingest)."""
        doc = self.db.get_document_file(job["document_file_id"])
        if not doc:
            raise RuntimeError("document_deleted")
        attachment = self.db.get_attachment(doc["attachment_id"])
        if not attachment:
            raise RuntimeError("attachment_not_found")
        source = tmp / safe_name(attachment["file_name"])
        self.r2.download(attachment["object_key"], source)
        self.assert_job_active(job["id"])
        limits = {**self.default_limits, **((job.get("input") or {}).get("limits") or {})}
        # Hide old content before any rows or images are replaced. Failed/cancelled
        # ingests stay unreadable; only successful completion publishes new ready stamps.
        self.db.update_document_file(doc["id"], {
            "processing_status": "processing",
            "text_ready_at": None,
            "visual_ready_at": None,
            "enriched_at": None,
        })
        meta = self.ingest_document(doc, attachment, source, tmp, limits, job_id=job["id"], report_progress=True)
        self.assert_job_active(job["id"])
        ready_at = now_iso()
        patch = {
            # Text and pages are stored together, so a document is either fully ready or not.
            "text_ready_at": ready_at,
            "page_count": meta.get("page_count"),
            "word_count": meta.get("word_count"),
            "metadata": {
                # A re-ingest keeps what other features stored (editable, generated-file and
                # editor flags) and replaces only what ingest derives from the file.
                **{
                    key: value for key, value in (doc.get("metadata") or {}).items()
                    if key not in INGEST_DERIVED_METADATA
                },
                **meta,
                "progress": 100,
                "stage": "ready",
                "warnings": [],
                "file_name": attachment["file_name"],
                "content_type": attachment["content_type"],
                "size_bytes": attachment["size_bytes"],
            },
            "error": None,
        }
        if meta.get("pipeline") == ingest.PIPELINE_PAGES:
            patch["visual_ready_at"] = ready_at
        return {
            "document_file_id": doc["id"],
            "status": "ready",
            "page_count": meta.get("page_count"),
            "visual_pages": len(meta.get("visual_pages") or []),
            "_document_patch": patch,
        }

    def legacy_noop_job(self, job, tmp):
        # Uploads are ingested by a single job now. Visual-enrichment and per-page render jobs
        # queued before the switch finish without doing anything.
        return {"status": "skipped", "reason": "single_ingest"}

    def limit(self, limits, key, fallback):
        try:
            value = int((limits or {}).get(key, fallback))
            return value if value > 0 else fallback
        except (TypeError, ValueError):
            return fallback

    def chunk(self, user_id, document_file_id, index, source_type, label, text, metadata=None):
        text = str(text or "")
        return {
            "user_id": user_id,
            "document_file_id": document_file_id,
            "chunk_index": index,
            "source_type": source_type,
            "source_label": label,
            "text": text,
            "char_count": len(text),
            "token_estimate": ingest.estimate_tokens(text),
            "metadata": metadata or {},
        }

    def ingest_document(self, doc, attachment, source, tmp, limits, job_id=None, pdf_override=None, report_progress=False):
        """Store a document completely as pages or rows. Returns the document metadata."""
        kind = str(doc.get("kind") or "").lower()
        base = dict(doc.get("metadata") or {})

        def progress(stage, value, **extra):
            if not report_progress:
                return
            base.update({"stage": stage, "progress": value, **extra})
            self.db.update_document_file(doc["id"], {"metadata": dict(base)})

        def check():
            if job_id:
                self.assert_job_active(job_id)

        work = tmp / f"ingest-{uuid.uuid4().hex}"
        work.mkdir(parents=True, exist_ok=True)
        if kind in ("pdf", "docx", "pptx"):
            return self.ingest_paged(doc, attachment, source, work, limits, progress, check, pdf_override)
        if kind in ("xlsx", "csv", "tsv"):
            return self.ingest_spreadsheet(doc, source, limits, progress, check)
        raise RuntimeError(f"unsupported_document_kind: {kind}")

    def ingest_paged(self, doc, attachment, source, work, limits, progress, check, pdf_override=None):
        started = time.monotonic()
        kind = str(doc.get("kind") or "").lower()
        user_id, doc_id = doc["user_id"], doc["id"]
        if kind == "pdf":
            pdf_path = source
        elif pdf_override and Path(pdf_override).exists():
            pdf_path = Path(pdf_override)
        else:
            progress("converting", 5)
            convert_from = source
            if kind == "pptx":
                # Hidden slides are part of the document: convert a copy with them shown.
                shown = work / "slides" / source.name
                shown.parent.mkdir(parents=True, exist_ok=True)
                try:
                    if ingest.unhide_slides(source, shown):
                        convert_from = shown
                except Exception as exc:
                    print(f"ingest {doc_id}: could not show hidden slides ({exc})", flush=True)
            pdf_path = self.libreoffice_convert(convert_from, work, "pdf")
            check()

        progress("reading_pages", 10)
        pages = ingest.read_pdf_pages(pdf_path, self.limit(limits, "max_pdf_pages", 150))
        page_count = len(pages)
        all_slides = ingest.pptx_slides(source, pptx_notes_text) if kind == "pptx" else []
        slides = ingest.map_slides_to_pages(all_slides, page_count) if kind == "pptx" else None
        check()

        progress("rendering_pages", 20, page_count=page_count)
        dpi = max(72, min(self.limit(limits, "visual_page_dpi", self.visual_page_dpi), 180))
        render_dir = work / "pages"
        render_dir.mkdir(parents=True, exist_ok=True)
        rendered = self.render_pdf_pages(pdf_path, render_dir, dpi, page_count=page_count)
        if len(rendered) != page_count:
            raise RuntimeError(f"pdf_render_failed: rendered {len(rendered)} of {page_count} pages")
        check()

        # Scanned pages have no text layer: read them by OCR so they can be searched and
        # quoted. Their images stay the source of truth for exact characters.
        ocr_pages = [index for index, page in enumerate(pages) if ingest.needs_ocr(page)]
        if ocr_pages and ingest.ocr_available():
            progress("reading_scans", 20, page_count=page_count)
            ocr_dir = work / "ocr"
            ocr_dir.mkdir(parents=True, exist_ok=True)
            scan_ppi = ingest.page_scan_ppi(pdf_path)

            def read_scan(index):
                number = pages[index]["number"]
                return ingest.ocr_pdf_page(pdf_path, number, ocr_dir, ingest.ocr_dpi_for(scan_ppi.get(number), self.ocr_dpi))
            with ThreadPoolExecutor(max_workers=max(1, min(self.pdf_render_workers, len(ocr_pages)))) as pool:
                found = list(pool.map(read_scan, ocr_pages))
            for index, text in zip(ocr_pages, found):
                if text:
                    pages[index]["text"] = text
                    pages[index]["ocr"] = True
                elif text is None:
                    pages[index]["ocr_failed"] = True
            check()
        elif ocr_pages:
            print(f"ingest {doc_id}: {len(ocr_pages)} scanned pages left without text (tesseract missing)", flush=True)
            for index in ocr_pages:
                pages[index]["ocr_failed"] = True

        scale = dpi / 72
        etag = attachment.get("etag") or doc.get("source_etag")
        page_rows = []
        chunks = []
        for page, image_path in zip(pages, rendered):
            number = page["number"]
            slide = slides[number - 1] if slides else None
            label = ingest.slide_label(slide, number) if kind == "pptx" else f"Page {number}"
            text = page["text"]
            if slide and slide.get("notes"):
                text = f"{text}\n\nSpeaker notes:\n{slide['notes']}".strip()
            visual = {
                "visual": page["visual"],
                "visual_reason": page["visual_reason"],
                **({"ocr": True} if page.get("ocr") else {}),
                **({"ocr_failed": True} if page.get("ocr_failed") else {}),
            }
            slide_meta = {"slide": slide["number"], **({"hidden": True} if slide["hidden"] else {})} if slide else {}
            page_rows.append({
                "user_id": user_id,
                "document_file_id": doc_id,
                "page_number": number,
                "source_label": label,
                # Previously-issued image URLs must keep pointing to the old page.
                "image_key": f"users/{user_id}/documents/{doc_id}/pages/{work.name}/page-{number:04d}.jpg",
                "image_content_type": "image/jpeg",
                "width_px": max(1, round(page["width_pt"] * scale)),
                "height_px": max(1, round(page["height_pt"] * scale)),
                "text": "",
                "char_count": len(text),
                "token_estimate": ingest.estimate_tokens(text),
                "metadata": {"page": number, **slide_meta, **visual, "source_kind": kind, "source_etag": etag},
                "_image_path": image_path,
            })
            chunks.append(self.chunk(
                user_id, doc_id, number - 1, "slide" if kind == "pptx" else "page", label, text,
                {
                    "page": number,
                    **slide_meta,
                    **visual,
                    # Older readers (study tools) look for these two flags.
                    "has_visual": page["visual"],
                    **({"visual_only": True} if page["visual"] and not text else {}),
                    "extractor": ingest.PIPELINE_PAGES,
                },
            ))

        uploaded = 0

        def upload(row):
            self.r2.upload(row["image_key"], row["_image_path"], "image/jpeg")
            return row["page_number"]

        with ThreadPoolExecutor(max_workers=min(self.page_upload_workers, max(1, page_count))) as pool:
            for future in as_completed([pool.submit(upload, row) for row in page_rows]):
                future.result()
                uploaded += 1
                if uploaded % 10 == 0 or uploaded == page_count:
                    check()
                    progress("saving_pages", 20 + int(70 * uploaded / page_count), page_count=page_count)

        self.db.insert_pages([{key: value for key, value in row.items() if key != "_image_path"} for row in page_rows])
        self.db.insert_chunks(chunks)
        self.remove_stale_rows(doc_id, chunk_count=len(chunks), page_count=page_count)
        check()

        visual_pages = [page["number"] for page in pages if page["visual"]]
        ocr_page_numbers = [page["number"] for page in pages if page.get("ocr")]
        text_tokens = sum(chunk["token_estimate"] for chunk in chunks)
        print(
            f"ingest {doc_id} kind={kind} pages={page_count} visual={len(visual_pages)} ocr={len(ocr_page_numbers)} "
            f"ocr_failed={sum(1 for page in pages if page.get('ocr_failed'))} "
            f"text_tokens={text_tokens} seconds={time.monotonic() - started:.1f}",
            flush=True,
        )
        meta = {
            "pipeline": ingest.PIPELINE_PAGES,
            "ingest_version": ingest.INGEST_VERSION,
            "mode": "pages",
            "source_kind": kind,
            "page_count": page_count,
            "word_count": sum(len(chunk["text"].split()) for chunk in chunks),
            "text_tokens": text_tokens,
            "visual_pages": visual_pages,
            "page_index": [
                ingest.page_index_entry(chunk["metadata"]["page"], chunk["source_label"], chunk["text"], chunk["metadata"]["visual"])
                for chunk in chunks
            ],
        }
        if ocr_page_numbers:
            meta["ocr_pages"] = ocr_page_numbers
        ocr_failed = [page["number"] for page in pages if page.get("ocr_failed")]
        if ocr_failed:
            meta["ocr_failed_pages"] = ocr_failed
        if slides and any(slide is None for slide in slides):
            meta["slide_numbers_unmatched"] = True
        hidden = [slide["number"] for slide in all_slides if slide["hidden"]]
        if hidden:
            meta["hidden_slides"] = hidden
            # Hidden slides normally have their own pages; if conversion still left them out, say so.
            if not slides or not any(slide and slide["hidden"] for slide in slides):
                meta["hidden_slides_missing"] = hidden
        return meta

    def ingest_spreadsheet(self, doc, source, limits, progress, check):
        kind = str(doc.get("kind") or "").lower()
        user_id, doc_id = doc["user_id"], doc["id"]
        progress("reading_rows", 10)
        if kind == "xlsx":
            sheets, extra = ingest.read_xlsx_sheets(
                source,
                self.limit(limits, "max_xlsx_sheets", 25),
                self.limit(limits, "max_xlsx_cells", 250000),
            )
        else:
            sheets, extra = ingest.read_delimited_sheet(
                source,
                kind,
                self.limit(limits, "max_csv_rows", 100000),
                self.limit(limits, "max_csv_columns", 100),
                detect_encoding=lambda path: getattr(from_path(str(path)).best(), "encoding", None),
            )
        chunks = ingest.sheet_chunks(
            sheets,
            lambda index, source_type, label, text, metadata: self.chunk(user_id, doc_id, index, source_type, label, text, metadata),
        )
        if not chunks:
            raise RuntimeError("empty_document: the spreadsheet has no data")
        check()
        progress("saving_rows", 60)
        self.db.insert_chunks(chunks)
        self.remove_stale_rows(doc_id, chunk_count=len(chunks), page_count=0)
        check()
        summaries = [sheet.summary() for sheet in sheets]
        sheet_count = len(sheets)
        self.db.update_document_file(doc_id, {
            "sheet_count": sheet_count,
            "used_cell_count": extra.get("used_cell_count"),
        })
        return {
            "pipeline": ingest.PIPELINE_SHEETS,
            "ingest_version": ingest.INGEST_VERSION,
            "mode": "rows",
            "source_kind": kind,
            "sheets": summaries,
            "sheet_count": sheet_count,
            "row_count": sum(summary["rows"] for summary in summaries),
            "used_cell_count": extra.get("used_cell_count"),
            "word_count": sum(len(chunk["text"].split()) for chunk in chunks),
            "text_tokens": sum(chunk["token_estimate"] for chunk in chunks),
            **({"formula_cache_trusted": extra["formula_cache_trusted"]} if "formula_cache_trusted" in extra else {}),
        }

    def remove_stale_rows(self, document_file_id, chunk_count, page_count):
        """A re-ingested document can come out shorter: drop rows (and page images) past its end."""
        self.db.request(
            "document_chunks",
            method="DELETE",
            params={"document_file_id": f"eq.{document_file_id}", "chunk_index": f"gte.{int(chunk_count)}"},
            prefer="return=minimal",
        )
        self.db.request(
            "document_pages",
            method="DELETE",
            params={"document_file_id": f"eq.{document_file_id}", "page_number": f"gt.{int(page_count)}"},
            prefer="return=minimal",
        )
        # Keep images for already-issued URLs. Unreferenced ingest generations are
        # swept after the storage grace period instead of breaking an in-flight read.

    def render_pdf_pages(self, path, output_dir, dpi=None, page_count=None, first_page=None, last_page=None):
        prefix = output_dir / "page"
        render_dpi = max(72, min(int(dpi or self.visual_page_dpi), 180))
        if first_page is not None and last_page is not None:
            ranges = [(int(first_page), int(last_page))]
        else:
            ranges = split_page_ranges(page_count, self.pdf_render_workers) if page_count else []

        def run_pdftoppm(first=None, last=None):
            cmd = build_pdftoppm_command(path, prefix, render_dpi, first=first, last=last)
            subprocess.run(
                cmd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

        if len(ranges) <= 1:
            if ranges:
                run_pdftoppm(ranges[0][0], ranges[0][1])
            else:
                run_pdftoppm()
        else:
            with ThreadPoolExecutor(max_workers=len(ranges)) as pool:
                futures = [pool.submit(run_pdftoppm, first, last) for first, last in ranges]
                for future in as_completed(futures):
                    future.result()

        def page_number(file_path):
            match = re.search(r"-(\d+)\.jpe?g$", file_path.name, re.I)
            return int(match.group(1)) if match else 0

        return sorted(output_dir.glob("page-*.jpg"), key=page_number)

    def create_job(self, job, tmp):
        self.artifact_warnings = []
        self.artifact_deck = None
        self.artifact_doc = None
        self.artifact_preview = None
        input_data = job.get("input") or {}
        fmt = input_data.get("format") or job["job_type"].split(".")[-1]
        title = input_data.get("title") or "Generated document"
        if fmt in ("docx", "pdf"):
            # The document engine renders the DocSpec straight to the requested format.
            path = self.create_js_artifact(tmp, title, input_data, fmt)
            if path is None:
                docx = self.create_docx(tmp, title, input_data)
                path = docx if fmt == "docx" else self.libreoffice_convert(docx, tmp, "pdf")
                self.artifact_warnings = ["document renderer failed; used the basic fallback layout"]
            content_type = (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                if fmt == "docx"
                else "application/pdf"
            )
        elif fmt == "xlsx":
            path = self.create_xlsx(tmp, title, input_data)
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fmt == "pptx":
            path = self.create_js_artifact(tmp, title, input_data, "pptx")
            if path is None:
                path = self.create_pptx(tmp, title, input_data)
                self.artifact_warnings = ["deck renderer failed; used the basic fallback layout"]
            content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            raise RuntimeError(f"Unsupported create format: {fmt}")
        output = self.store_generated(job, tmp, path, fmt, content_type, "generated", None)
        self.store_doc_preview(job, tmp, output)
        if self.artifact_warnings:
            output["quality_warnings"] = list(self.artifact_warnings)
        if fmt == "pptx" and self.artifact_deck:
            output["deck"] = self.artifact_deck
        if fmt in ("docx", "pdf") and self.artifact_doc:
            output["doc"] = self.artifact_doc
        return output

    def store_doc_preview(self, job, tmp, output):
        # A DOCX from the document engine ships with the PDF printed from the same spec, stored
        # as its preview so the viewer never falls back to a LibreOffice conversion.
        preview = self.artifact_preview
        self.artifact_preview = None
        if not preview or output.get("kind") != "docx" or not Path(preview).exists():
            return
        try:
            parent = self.db.get_document_file(output["document_file_id"])
            preview_job = {**job, "input": {**(job.get("input") or {}), "preview": True}}
            stored = self.store_generated(preview_job, tmp, Path(preview), "pdf", "application/pdf", "exported", parent)
            output["preview_attachment_id"] = stored.get("attachment_id")
        except Exception as exc:
            print(f"document preview store failed: {exc}", flush=True)

    def create_js_artifact(self, tmp, title, input_data, fmt):
        if not USE_JS_ARTIFACT_GENERATOR:
            return None
        generator = Path(NODE_ARTIFACT_GENERATOR)
        if not generator.exists():
            return None
        self.artifact_deck = None
        payload = dict(input_data or {})
        payload["format"] = fmt
        payload["title"] = title
        input_path = tmp / f"artifact-input-{uuid.uuid4()}.json"
        outdir = tmp / f"artifact-out-{uuid.uuid4()}"
        outdir.mkdir(exist_ok=True)
        input_path.write_text(json.dumps(payload), encoding="utf-8")
        cmd = [NODE_BIN, str(generator), str(input_path), str(outdir)]
        try:
            result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=180)
            data = json.loads(result.stdout or "{}")
            output = Path(data.get("path") or "")
            if not output.exists():
                raise RuntimeError("JS artifact generator did not produce an output file.")
            resolved_output = output.resolve()
            resolved_outdir = outdir.resolve()
            if resolved_outdir not in resolved_output.parents:
                raise RuntimeError("JS artifact generator returned a path outside the output directory.")
            if output.suffix.lower() != f".{fmt}":
                raise RuntimeError("JS artifact generator returned the wrong file type.")
            warnings = [str(item)[:240] for item in (data.get("warnings") or []) if item][:20]
            if warnings:
                print(f"{fmt} quality warnings ({len(warnings)}): {' | '.join(warnings[:6])}", flush=True)
            self.artifact_warnings = warnings
            # The DeckSpec as rendered; stored on the job so edits start from what is on the slides.
            deck = data.get("deck")
            self.artifact_deck = deck if isinstance(deck, dict) and isinstance(deck.get("slides"), list) else None
            # The DocSpec likewise: precise document edits address its block ids.
            doc = data.get("doc")
            self.artifact_doc = doc if isinstance(doc, dict) and isinstance(doc.get("blocks"), list) else None
            preview = Path(data.get("preview_path") or "")
            self.artifact_preview = preview if preview.name and preview.exists() and resolved_outdir in preview.resolve().parents else None
            return output
        except Exception as exc:
            print(f"JS artifact generator failed for {fmt}; using Python fallback: {exc}", flush=True)
            return None

    def create_docx(self, tmp, title, input_data):
        doc = Document()
        section = doc.sections[0]
        section.top_margin = DocxInches(0.7)
        section.bottom_margin = DocxInches(0.7)
        section.left_margin = DocxInches(0.8)
        section.right_margin = DocxInches(0.8)
        doc.add_heading(title, level=1)
        body = strip_duplicate_title_heading(artifact_content(input_data), title)
        if body:
            self.append_docx_markdown(doc, body)
        else:
            instructions = input_data.get("instructions") or ""
            for block in instructions.split("\n\n"):
                if block.strip():
                    doc.add_paragraph(clean_markdown(block))
        for section in input_data.get("sections") or []:
            heading = section.get("heading") or section.get("title")
            if heading:
                doc.add_heading(str(heading), level=2)
            content = section.get("content") or section.get("text") or ""
            if content:
                self.append_docx_markdown(doc, str(content))
        for table in input_data.get("tables") or []:
            self.append_docx_table(doc, table)
        path = tmp / f"{safe_name(title)}.docx"
        doc.save(path)
        return path

    def append_docx_markdown(self, doc, text):
        in_code = False
        code_lines = []
        lines = str(text or "").splitlines()
        index = 0
        while index < len(lines):
            raw_line = lines[index]
            line = raw_line.strip()
            if line.startswith("```"):
                if in_code:
                    self.append_docx_code_block(doc, "\n".join(code_lines))
                    code_lines = []
                    in_code = False
                else:
                    in_code = True
                    code_lines = []
                index += 1
                continue
            if in_code:
                code_lines.append(raw_line.rstrip())
                index += 1
                continue
            if not line:
                index += 1
                continue
            table_data, next_index = collect_markdown_table(lines, index)
            if table_data:
                self.append_docx_table(doc, table_data)
                index = next_index
                continue
            if re.match(r"^-{3,}$", line):
                index += 1
                continue
            heading = re.match(r"^(#{1,3})\s+(.+)$", line)
            if heading:
                doc.add_heading(clean_markdown(heading.group(2)), level=min(len(heading.group(1)), 3))
                index += 1
                continue
            bullet = re.match(r"^[-*]\s+(.+)$", line)
            if bullet:
                doc.add_paragraph(clean_markdown(bullet.group(1)), style="List Bullet")
                index += 1
                continue
            numbered = re.match(r"^\d+[.)]\s+(.+)$", line)
            if numbered:
                doc.add_paragraph(clean_markdown(numbered.group(1)), style="List Number")
                index += 1
                continue
            doc.add_paragraph(clean_markdown(line))
            index += 1
        if in_code and code_lines:
            self.append_docx_code_block(doc, "\n".join(code_lines))

    def append_docx_code_block(self, doc, text):
        paragraph = doc.add_paragraph()
        run = paragraph.add_run(normalize_math_symbols(text).strip())
        run.font.name = "Courier New"

    def append_docx_table(self, doc, table_data):
        title = table_data.get("title") or table_data.get("caption")
        if title:
            doc.add_heading(str(title), level=2)
        rows = table_data.get("rows") or table_data.get("data") or []
        headers = table_data.get("headers") or []
        if headers:
            rows = [headers] + rows
        if not rows:
            return
        width = max(len(row) if isinstance(row, list) else 1 for row in rows)
        table = doc.add_table(rows=0, cols=max(1, width))
        table.style = "Table Grid"
        for row in rows[:200]:
            cells = table.add_row().cells
            values = normalize_table_row_width(row if isinstance(row, list) else [row], width)
            for i, value in enumerate(values[:width]):
                cells[i].text = clean_markdown(str(value))

    def create_xlsx(self, tmp, title, input_data):
        path = tmp / f"{safe_name(title)}.xlsx"
        payload = dict(input_data or {})
        payload["title"] = title
        create_xlsx_workbook(path, payload)
        return self.recalculate_xlsx(path, tmp)

    def create_pptx(self, tmp, title, input_data):
        prs = Presentation()
        prs.slide_width = PptxInches(13.333)
        prs.slide_height = PptxInches(7.5)
        slides = self.presentation_slides(title, input_data)
        for index, slide_data in enumerate(slides[:40]):
            self.append_pptx_slide(prs, slide_data, is_first=(index == 0))
        path = tmp / f"{safe_name(title)}.pptx"
        prs.save(path)
        return path

    def presentation_slides(self, title, input_data):
        data = input_data.get("data") if isinstance(input_data.get("data"), dict) else {}
        slides = data.get("slides") if isinstance(data.get("slides"), list) else []
        if slides:
            return [self.normalize_slide_data(slide, title if index == 0 else "") for index, slide in enumerate(slides)]

        out = []
        content = strip_duplicate_title_heading(artifact_content(input_data), title)
        if content:
            out = self.slides_from_markdown(title, content)
        if not out:
            sections = input_data.get("sections") if isinstance(input_data.get("sections"), list) else []
            if sections:
                out.append({"title": title, "subtitle": input_data.get("instructions") or "", "bullets": []})
                for section in sections:
                    out.append({
                        "title": section.get("heading") or section.get("title") or "Section",
                        "subtitle": section.get("message") or "",
                        "bullets": self.text_to_bullets(section.get("content") or section.get("text") or "")
                    })
        if not out:
            out = [
                {"title": title, "subtitle": input_data.get("instructions") or "", "bullets": []},
                {"title": "Overview", "bullets": self.text_to_bullets(input_data.get("instructions") or "Generated presentation")}
            ]
        return out

    def normalize_slide_data(self, slide, fallback_title=""):
        if not isinstance(slide, dict):
            return {"title": clean_markdown(str(slide)), "bullets": []}
        bullets = slide.get("bullets") or slide.get("points") or slide.get("items") or []
        if isinstance(bullets, str):
            bullets = self.text_to_bullets(bullets)
        elif not isinstance(bullets, list):
            bullets = []
        return {
            "title": clean_markdown(slide.get("title") or slide.get("heading") or fallback_title or "Slide"),
            "subtitle": clean_markdown(slide.get("subtitle") or slide.get("message") or slide.get("takeaway") or ""),
            "bullets": [clean_markdown(item) for item in bullets if clean_markdown(item)][:8],
            "notes": str(slide.get("notes") or slide.get("speaker_notes") or "").strip(),
            "table": slide.get("table") if isinstance(slide.get("table"), dict) else None,
        }

    def slides_from_markdown(self, title, content):
        slides = [{"title": title, "subtitle": "", "bullets": []}]
        current = None
        for raw_line in str(content or "").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            heading = re.match(r"^#{1,3}\s+(.+)$", line)
            if heading:
                current = {"title": clean_markdown(heading.group(1)), "bullets": []}
                slides.append(current)
                continue
            bullet = re.match(r"^[-*]\s+(.+)$", line) or re.match(r"^\d+[.)]\s+(.+)$", line)
            if bullet:
                if not current:
                    current = {"title": "Key Points", "bullets": []}
                    slides.append(current)
                current.setdefault("bullets", []).append(clean_markdown(bullet.group(1)))
                continue
            if not current:
                slides[0]["subtitle"] = (slides[0].get("subtitle") or line)[:180]
            elif len(current.get("bullets", [])) < 6:
                current.setdefault("bullets", []).append(clean_markdown(line))
        return [self.normalize_slide_data(slide) for slide in slides if slide.get("title") or slide.get("subtitle") or slide.get("bullets")]

    def text_to_bullets(self, text):
        bullets = []
        for line in str(text or "").splitlines():
            cleaned = clean_markdown(re.sub(r"^[-*\d.)\s]+", "", line).strip())
            if cleaned:
                bullets.append(cleaned)
        if not bullets and str(text or "").strip():
            parts = re.split(r"(?<=[.!?])\s+", clean_markdown(text))
            bullets = [part for part in parts if part][:6]
        return bullets[:8]

    def append_pptx_slide(self, prs, slide_data, is_first=False):
        slide_data = self.normalize_slide_data(slide_data)
        if is_first:
            slide = prs.slides.add_slide(prs.slide_layouts[0])
            slide.shapes.title.text = slide_data["title"] or "Presentation"
            subtitle = slide.placeholders[1]
            subtitle.text = slide_data.get("subtitle") or ""
            self.style_pptx_title(slide.shapes.title, size=34)
            self.style_pptx_text(subtitle, size=17, color=RGBColor(90, 90, 90))
        else:
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            self.add_pptx_title(slide, slide_data["title"])
            if slide_data.get("subtitle"):
                self.add_pptx_textbox(slide, slide_data["subtitle"], 0.7, 1.15, 11.8, 0.55, size=15, color=RGBColor(80, 80, 80))
            if slide_data.get("table"):
                self.add_pptx_table(slide, slide_data["table"], 0.7, 1.9, 11.8, 4.5)
            else:
                self.add_pptx_bullets(slide, slide_data.get("bullets") or [], 1.0, 1.85, 11.0, 4.8)
        notes = slide_data.get("notes")
        if notes:
            try:
                slide.notes_slide.notes_text_frame.text = notes[:2000]
            except Exception:
                pass

    def add_pptx_title(self, slide, title):
        box = slide.shapes.add_textbox(PptxInches(0.6), PptxInches(0.35), PptxInches(12.0), PptxInches(0.65))
        frame = box.text_frame
        frame.clear()
        paragraph = frame.paragraphs[0]
        paragraph.text = clean_markdown(title or "Slide")
        paragraph.font.size = Pt(26)
        paragraph.font.bold = True
        paragraph.font.color.rgb = RGBColor(24, 24, 24)
        paragraph.alignment = PP_ALIGN.LEFT

    def add_pptx_textbox(self, slide, text, x, y, w, h, size=16, color=None):
        box = slide.shapes.add_textbox(PptxInches(x), PptxInches(y), PptxInches(w), PptxInches(h))
        box.text_frame.word_wrap = True
        box.text_frame.text = clean_markdown(text)
        self.style_pptx_text(box, size=size, color=color or RGBColor(40, 40, 40))
        return box

    def add_pptx_bullets(self, slide, bullets, x, y, w, h):
        box = slide.shapes.add_textbox(PptxInches(x), PptxInches(y), PptxInches(w), PptxInches(h))
        frame = box.text_frame
        frame.word_wrap = True
        frame.clear()
        items = bullets or ["Add the key point for this slide."]
        for index, item in enumerate(items[:8]):
            paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
            paragraph.text = clean_markdown(item)
            paragraph.level = 0
            paragraph.font.size = Pt(18 if len(items) <= 5 else 15)
            paragraph.font.color.rgb = RGBColor(35, 35, 35)
            paragraph.space_after = Pt(8)

    def add_pptx_table(self, slide, table_data, x, y, w, h):
        rows = table_data.get("rows") or table_data.get("data") or []
        headers = table_data.get("headers") or []
        if headers:
            rows = [headers] + rows
        rows = [row if isinstance(row, list) else [row] for row in rows[:12]]
        if not rows:
            return
        cols = max(1, max(len(row) for row in rows))
        shape = slide.shapes.add_table(len(rows), cols, PptxInches(x), PptxInches(y), PptxInches(w), PptxInches(h))
        table = shape.table
        for row_index, row in enumerate(rows):
            values = normalize_table_row_width(row, cols)
            for col_index, value in enumerate(values[:cols]):
                cell = table.cell(row_index, col_index)
                cell.text = clean_markdown(str(value))
                for paragraph in cell.text_frame.paragraphs:
                    paragraph.font.size = Pt(10 if cols > 4 else 12)
                    paragraph.font.bold = row_index == 0
                    paragraph.font.color.rgb = RGBColor(24, 24, 24)

    def style_pptx_title(self, shape, size=30):
        for paragraph in shape.text_frame.paragraphs:
            paragraph.font.size = Pt(size)
            paragraph.font.bold = True
            paragraph.font.color.rgb = RGBColor(24, 24, 24)

    def style_pptx_text(self, shape, size=16, color=None):
        for paragraph in shape.text_frame.paragraphs:
            paragraph.font.size = Pt(size)
            paragraph.font.color.rgb = color or RGBColor(45, 45, 45)

    def edit_job(self, job, tmp):
        self.artifact_warnings = []
        self.artifact_deck = None
        self.artifact_doc = None
        self.artifact_preview = None
        source_doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(source_doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        kind = source_doc["kind"]
        input_data = job.get("input") or {}
        spec = (input_data.get("data") or {}).get("doc")
        if kind in ("docx", "pdf") and isinstance(spec, dict) and isinstance(spec.get("blocks"), list):
            # Klui documents re-render from the edited DocSpec: only the addressed blocks change.
            title = str(input_data.get("title") or spec.get("title") or Path(attachment["file_name"]).stem)
            rendered = self.create_js_artifact(tmp, title, {"data": {"doc": spec}, "title": title}, kind)
            if rendered is None:
                raise RuntimeError("doc_render_failed: the edited document could not be rendered")
            output = tmp / f"{Path(attachment['file_name']).stem}.{kind}"
            shutil.move(str(rendered), output)
            content_type = "application/pdf" if kind == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            stored = self.store_generated(job, tmp, output, kind, content_type, "edited", source_doc)
            self.store_doc_preview(job, tmp, stored)
            if self.artifact_doc:
                stored["doc"] = self.artifact_doc
            if self.artifact_warnings:
                stored["quality_warnings"] = list(self.artifact_warnings)
            return stored
        self.r2.download(attachment["object_key"], source)
        if kind == "pdf":
            output = self.edit_pdf(source, tmp, input_data)
            stored = self.store_generated(job, tmp, output, kind, "application/pdf", "edited", source_doc)
            if self.artifact_warnings:
                stored["quality_warnings"] = list(self.artifact_warnings)
            return stored
        if kind == "docx":
            output = self.edit_docx(source, tmp, job.get("input") or {})
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif kind == "xlsx":
            output = self.edit_xlsx(source, tmp, job.get("input") or {})
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif kind == "pptx":
            output = self.edit_pptx(source, tmp, job.get("input") or {})
            content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            raise RuntimeError("Editing this document type is not supported yet.")
        stored = self.store_generated(job, tmp, output, kind, content_type, "edited", source_doc)
        if self.artifact_warnings:
            stored["quality_warnings"] = list(self.artifact_warnings)
        if kind == "pptx" and self.artifact_deck:
            stored["deck"] = self.artifact_deck
        return stored

    def edit_pptx(self, source, tmp, input_data):
        self.artifact_warnings = []
        deck = (input_data.get("data") or {}).get("deck")
        if isinstance(deck, dict) and isinstance(deck.get("slides"), list):
            # Klui decks re-render from the edited DeckSpec; the basic fallback would lose the design.
            title = str(input_data.get("title") or deck.get("title") or source.stem)
            rendered = self.create_js_artifact(tmp, title, {"data": {"deck": deck}}, "pptx")
            if rendered is None:
                raise RuntimeError("deck_render_failed: the edited deck could not be rendered")
            output = tmp / f"edited-{re.sub(r'^(edited-)+', '', source.stem)}.pptx"
            shutil.move(str(rendered), output)
            return output
        return self.replace_pptx_text(source, tmp, input_data.get("operations") or [])

    def replace_pptx_text(self, source, tmp, operations):
        prs = Presentation(str(source))
        replacements = [
            op for op in operations
            if isinstance(op, dict) and str(op.get("type") or "") == "replace_text" and str(op.get("find") or "")
        ]
        if not replacements:
            raise RuntimeError("pptx_edit_requires_replace_text_operations")
        missing = []
        for op in replacements[:100]:
            find = str(op.get("find"))
            replace = str(op.get("replace") or "")
            slide_filter = op.get("slide")
            count = 0
            for number, slide in enumerate(prs.slides, start=1):
                if slide_filter not in (None, "") and int(slide_filter) != number:
                    continue
                for paragraph in iter_pptx_paragraphs(slide.shapes):
                    count += replace_in_paragraph(paragraph, find, replace)
            if not count:
                missing.append(find[:60])
        if len(missing) == len(replacements[:100]):
            raise RuntimeError(f"pptx_text_not_found: {', '.join(missing[:3])}")
        self.artifact_warnings = [f"text not found: {item}" for item in missing[:10]]
        output = tmp / f"edited-{re.sub(r'^(edited-)+', '', source.name)}"
        prs.save(output)
        return output

    def edit_docx(self, source, tmp, input_data):
        # Run-level edits that keep every style, numbering and table layout of the original.
        operations = []
        for op in input_data.get("operations") or []:
            if not isinstance(op, dict):
                continue
            if not op.get("type") and (op.get("find") or op.get("old_text")):
                op = {"type": "replace_text", "find": op.get("find") or op.get("old_text"), "replace": op.get("replace") or op.get("new_text") or ""}
            operations.append(op)
        if not operations:
            raise RuntimeError("docx_edit_requires_operations")
        output = tmp / f"{re.sub(r'^(edited-)+', '', source.stem)}.docx"
        if output == source:
            output = tmp / f"edited-{source.name}"
        _applied, warnings = docx_edit.apply_operations(source, output, operations)
        self.artifact_warnings = warnings[:10]
        return output

    def edit_pdf(self, source, tmp, input_data):
        operations = [op for op in (input_data.get("operations") or []) if isinstance(op, dict)]
        if not operations:
            raise RuntimeError("pdf_edit_requires_operations")
        output = tmp / f"{re.sub(r'^(edited-)+', '', source.stem)}-edited.pdf"
        _applied, warnings = pdf_edit.apply_operations(source, output, operations)
        self.artifact_warnings = warnings[:10]
        final = tmp / "out-final"
        final.mkdir(exist_ok=True)
        target = final / source.name
        shutil.move(str(output), target)
        return target

    def edit_xlsx(self, source, tmp, input_data):
        wb = load_workbook(str(source))
        operations = input_data.get("operations") or []
        if not operations:
            raise RuntimeError("xlsx_edit_requires_operations")
        if len(operations) > 100:
            raise RuntimeError("xlsx_edit_too_many_operations")
        changed_cells = 0

        def require_sheet(op):
            sheet_name = str(op.get("sheet") or "").strip()
            if not sheet_name or sheet_name not in wb.sheetnames:
                raise RuntimeError(f"xlsx_sheet_not_found: {sheet_name or '(missing)'}")
            return wb[sheet_name]

        def bounds(op, key="range"):
            reference = str(op.get(key) or "").strip().upper()
            if not reference:
                raise RuntimeError(f"xlsx_edit_missing_{key}")
            try:
                return reference, range_boundaries(reference)
            except ValueError as exc:
                raise RuntimeError(f"xlsx_edit_invalid_{key}: {reference}") from exc

        def safe_value(value):
            return validate_formula(value) if isinstance(value, str) and value.startswith("=") else value

        for op in operations:
            if not isinstance(op, dict):
                raise RuntimeError("xlsx_edit_operation_must_be_object")
            operation = str(op.get("type") or "").strip().lower()

            if operation == "add_sheet":
                name = str(op.get("name") or "").strip()
                if not name or len(name) > 31 or name in wb.sheetnames:
                    raise RuntimeError(f"xlsx_invalid_new_sheet: {name or '(missing)'}")
                wb.create_sheet(name)
                continue

            ws = require_sheet(op)
            if operation == "rename_sheet":
                name = str(op.get("new_name") or "").strip()
                if not name or len(name) > 31 or name in wb.sheetnames:
                    raise RuntimeError(f"xlsx_invalid_new_sheet: {name or '(missing)'}")
                ws.title = name
            elif operation == "delete_sheet":
                if len(wb.sheetnames) == 1:
                    raise RuntimeError("xlsx_cannot_delete_last_sheet")
                wb.remove(ws)
            elif operation in ("set_cell", "set_formula"):
                reference, (min_col, min_row, max_col, max_row) = bounds(op, "cell")
                if min_col != max_col or min_row != max_row:
                    raise RuntimeError(f"xlsx_edit_cell_must_be_single: {reference}")
                if operation == "set_cell" and "value" not in op:
                    raise RuntimeError("xlsx_edit_missing_value")
                value = op.get("formula") if operation == "set_formula" else op.get("value")
                ws.cell(min_row, min_col).value = safe_value(value)
                changed_cells += 1
            elif operation == "set_range":
                reference, (min_col, min_row, max_col, max_row) = bounds(op)
                values = op.get("values")
                expected_rows = max_row - min_row + 1
                expected_columns = max_col - min_col + 1
                if not isinstance(values, list) or len(values) != expected_rows:
                    raise RuntimeError(f"xlsx_edit_range_row_mismatch: {reference}")
                for row_offset, row in enumerate(values):
                    if not isinstance(row, list) or len(row) != expected_columns:
                        raise RuntimeError(f"xlsx_edit_range_column_mismatch: {reference}")
                    for column_offset, value in enumerate(row):
                        ws.cell(min_row + row_offset, min_col + column_offset).value = safe_value(value)
                        changed_cells += 1
            elif operation == "append_rows":
                rows = op.get("rows")
                if not rows or not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
                    raise RuntimeError("xlsx_edit_rows_must_be_arrays")
                for row in rows:
                    ws.append([safe_value(value) for value in row])
                    changed_cells += len(row)
            elif operation == "clear_range":
                reference, (min_col, min_row, max_col, max_row) = bounds(op)
                for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
                    for cell in row:
                        cell.value = None
                        changed_cells += 1
            elif operation == "set_number_format":
                reference, (min_col, min_row, max_col, max_row) = bounds(op)
                number_format = str(op.get("format") or "").strip()
                if not number_format or len(number_format) > 100:
                    raise RuntimeError("xlsx_edit_invalid_number_format")
                for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
                    for cell in row:
                        cell.number_format = number_format
                        changed_cells += 1
            else:
                raise RuntimeError(f"xlsx_edit_unknown_operation: {operation or '(missing)'}")

            if changed_cells > 250000:
                raise RuntimeError("xlsx_edit_too_many_cells")

        output = tmp / f"edited-{source.name}"
        wb.calculation.fullCalcOnLoad = True
        wb.calculation.forceFullCalc = True
        wb.calculation.calcMode = "auto"
        wb.save(output)
        wb.close()
        return self.recalculate_xlsx(output, tmp)

    def recalculate_xlsx(self, source, tmp):
        output = tmp / "recalculated" / source.name
        profile = tmp / f"lo-calc-{uuid.uuid4()}"
        script = Path(__file__).with_name("recalculate_xlsx.py")
        subprocess.run(
            ["/usr/bin/python3", str(script), str(source), str(output), str(profile)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=90,
        )
        formulas = load_workbook(str(output), read_only=True, data_only=False)
        values = load_workbook(str(output), read_only=True, data_only=True)
        try:
            for sheet_name in formulas.sheetnames:
                value_sheet = values[sheet_name]
                for row in formulas[sheet_name].iter_rows():
                    for cell in row:
                        if cell.data_type != "f":
                            continue
                        result = value_sheet[cell.coordinate]
                        if result.value is None or result.data_type == "e":
                            raise RuntimeError(
                                f"xlsx_formula_error: {sheet_name}!{cell.coordinate}"
                            )
        finally:
            formulas.close()
            values.close()
        return output

    def export_job(self, job, tmp):
        self.artifact_doc = None
        self.artifact_preview = None
        source_doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(source_doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        input_data = job.get("input") or {}
        target = input_data.get("target_format") or "pdf"
        spec = (input_data.get("data") or {}).get("doc")
        if target in ("docx", "pdf") and isinstance(spec, dict) and isinstance(spec.get("blocks"), list):
            # A Klui document exports by rendering its DocSpec, never through a converter.
            title = Path(input_data.get("output_file_name") or attachment["file_name"]).stem
            rendered = self.create_js_artifact(tmp, title, {"data": {"doc": spec}, "title": title, "preview_pdf": False}, target)
            if rendered is None:
                raise RuntimeError("doc_render_failed: the document could not be exported")
            content_type = "application/pdf" if target == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            return self.store_generated(job, tmp, rendered, target, content_type, "exported", source_doc)
        self.r2.download(attachment["object_key"], source)
        if source_doc["kind"] == target:
            output = tmp / source.name
            shutil.copyfile(source, output)
        elif target == "pdf" and source_doc["kind"] in ("docx", "xlsx", "pptx"):
            output = self.libreoffice_convert(source, tmp, "pdf")
        else:
            raise RuntimeError("Unsupported export conversion.")
        content_type = "application/pdf" if target == "pdf" else attachment["content_type"]
        return self.store_generated(job, tmp, output, target, content_type, "exported", source_doc)

    def libreoffice_convert(self, source, tmp, target):
        outdir = tmp / "out"
        outdir.mkdir(exist_ok=True)
        profile = tmp / f"lo-{uuid.uuid4()}"
        cmd = [
            "soffice",
            "--headless",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            target,
            "--outdir",
            str(outdir),
            str(source),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
        converted = outdir / f"{source.stem}.{target}"
        if not converted.exists():
            raise RuntimeError("LibreOffice conversion failed.")
        return converted

    def store_generated(self, job, tmp, path, kind, content_type, source, parent_doc):
        user_id = job["user_id"]
        input_data = job.get("input") or {}
        preview = bool(input_data.get("preview"))
        editor_markdown = str(input_data.get("editor_markdown") or "").strip()
        editor_metadata = {
            "editor_markdown": editor_markdown,
            "editor_revision": 1,
            "editable": True,
        } if editor_markdown and kind in ("docx", "pdf") and not preview else {}
        size_bytes = path.stat().st_size
        max_bytes = input_data.get("account_max_bytes")
        if not max_bytes:
            # ponytail: pre-quota jobs have no cap; Max ceiling until the queue drains
            max_bytes = env_int("PLAN_MAX_MAX_STORAGE_BYTES", 5 * 1024 * 1024 * 1024)
        project_id = input_data.get("project_id") or (parent_doc or {}).get("project_id")
        key = self.object_key(user_id, path.name)
        attachment = None
        try:
            attachment = self.db.reserve_attachment({
                "user_id": user_id,
                "max_bytes": max_bytes,
                "category": "document",
                "object_key": key,
                "file_name": path.name,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "conversation_id": job.get("conversation_id"),
                "message_id": job.get("message_id"),
                "project_id": project_id,
            })
            etag = self.r2.upload(key, path, content_type)
            attachment = self.db.complete_reserved_attachment({
                "user_id": user_id,
                "attachment_id": attachment["id"],
                "size_bytes": size_bytes,
                "etag": etag,
                "max_bytes": max_bytes,
            })
            document_file = self.db.create_document_file({
                "attachment_id": attachment["id"],
                "queue": job.get("queue", "production"),
                "user_id": user_id,
                "conversation_id": job.get("conversation_id"),
                "message_id": job.get("message_id"),
                "project_id": project_id,
                "kind": kind,
                "source": source,
                "parent_document_id": parent_doc["id"] if parent_doc else None,
                "version_no": int(parent_doc.get("version_no", 0)) + 1 if parent_doc else 1,
                "source_etag": attachment.get("etag") or etag,
                "processing_status": "processing",
                "metadata": {"generated_by_job": job["id"], **editor_metadata, **({"preview": True} if preview else {})},
            })
            if preview:
                # A viewer preview of another document; chats never read it, so it is not ingested.
                meta = {}
            else:
                meta = self.ingest_document(
                    document_file,
                    {**attachment, "file_name": attachment.get("file_name") or path.name},
                    path,
                    tmp,
                    self.default_limits,
                    job_id=job.get("id"),
                    # The document engine prints the PDF of a Word file from the same spec.
                    pdf_override=self.artifact_preview if kind == "docx" else None,
                )
            ready_at = now_iso()
            self.db.update_document_file(document_file["id"], {
                "processing_status": "ready",
                "text_ready_at": ready_at,
                **({"visual_ready_at": ready_at} if meta.get("pipeline") == ingest.PIPELINE_PAGES else {}),
                "page_count": meta.get("page_count"),
                "word_count": meta.get("word_count"),
                "sheet_count": meta.get("sheet_count"),
                "used_cell_count": meta.get("used_cell_count"),
                "metadata": {**meta, "generated_by_job": job["id"], **editor_metadata, **({"preview": True} if preview else {})},
                "error": None,
            })
        except Exception:
            r2_deleted = False
            try:
                self.r2.delete(key)
                r2_deleted = True
            except Exception:
                pass
            if r2_deleted and attachment and attachment.get("id"):
                try:
                    self.db.delete_attachment(user_id, attachment["id"])
                except Exception:
                    pass
            raise
        return {
            "attachment_id": attachment["id"],
            "document_file_id": document_file["id"],
            "file_name": attachment["file_name"],
            "kind": kind,
            "status": "ready",
            **({"preview": True} if preview else {}),
            "download_url": f"/api/attachments/{attachment['id']}/download",
        }


def worker_concurrency():
    return env_int("DOCUMENT_WORKER_CONCURRENCY", 1, minimum=1, maximum=WORKER_CONCURRENCY_CAP)


def main():
    concurrency = worker_concurrency()
    if concurrency <= 1:
        Processor().run()
        return

    print(f"starting {concurrency} document worker loops", flush=True)
    threads = []
    for index in range(concurrency):
        processor = Processor(index, concurrency)
        thread = threading.Thread(target=processor.run, name=processor.worker_id, daemon=True)
        thread.start()
        threads.append(thread)
    for thread in threads:
        thread.join()


if __name__ == "__main__":
    main()
