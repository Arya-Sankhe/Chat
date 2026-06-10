import base64
import csv
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

import boto3
import pdfplumber
import requests
import reportlab
from charset_normalizer import from_path
from docx import Document
from docx.shared import Inches as DocxInches
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches as PptxInches
from pptx.util import Pt
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle


def env(name, default=""):
    return os.environ.get(name, default).strip()


NODE_ARTIFACT_GENERATOR = env("DOCUMENT_ARTIFACT_GENERATOR", str(Path(__file__).resolve().parent / "artifact_generator.mjs"))
NODE_BIN = env("DOCUMENT_NODE_BIN", "node")
USE_JS_ARTIFACT_GENERATOR = env("DOCUMENT_USE_JS_ARTIFACT_GENERATOR", "1").lower() not in ("0", "false", "no")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def safe_name(value, fallback="document"):
    base = Path(str(value or fallback)).name
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in base).strip("-")
    return (cleaned or fallback)[:120]


def truncate(text, limit):
    text = str(text or "")
    return text if len(text) <= limit else text[: max(0, limit - 20)] + "\n...[truncated]"


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


def find_existing_file(candidates):
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return str(path)
    return None


def register_pdf_fonts():
    reportlab_fonts = Path(reportlab.__file__).resolve().parent / "fonts"
    regular = find_existing_file([
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        Path(__file__).resolve().parent.parent / "fonts" / "DejaVuSans.ttf",
        reportlab_fonts / "Vera.ttf",
    ])
    bold = find_existing_file([
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        Path(__file__).resolve().parent.parent / "fonts" / "DejaVuSans-Bold.ttf",
        reportlab_fonts / "VeraBd.ttf",
    ])
    mono = find_existing_file([
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        Path(__file__).resolve().parent.parent / "fonts" / "DejaVuSansMono.ttf",
        reportlab_fonts / "Vera.ttf",
    ])

    fonts = {"regular": "Helvetica", "bold": "Helvetica-Bold", "mono": "Courier"}
    try:
        if regular:
            pdfmetrics.registerFont(TTFont("KluiSans", regular))
            fonts["regular"] = "KluiSans"
        if bold:
            pdfmetrics.registerFont(TTFont("KluiSans-Bold", bold))
            fonts["bold"] = "KluiSans-Bold"
        elif regular:
            fonts["bold"] = "KluiSans"
        if mono:
            pdfmetrics.registerFont(TTFont("KluiMono", mono))
            fonts["mono"] = "KluiMono"
    except Exception:
        return {"regular": "Helvetica", "bold": "Helvetica-Bold", "mono": "Courier"}
    return fonts


class Supabase:
    def __init__(self):
        self.url = env("SUPABASE_URL").rstrip("/")
        self.key = env("SUPABASE_SERVICE_ROLE_KEY")
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

    def request(self, path, method="GET", params=None, body=None, prefer=None):
        response = requests.request(
            method,
            f"{self.url}/rest/v1/{path}",
            headers=self._headers(prefer),
            params={k: v for k, v in (params or {}).items() if v is not None and v != ""},
            data=json.dumps(body) if body is not None else None,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Supabase {method} {path} failed: {response.status_code} {response.text}")
        if response.status_code == 204 or not response.text:
            return None
        return response.json()

    def rpc(self, name, body):
        return self.request(f"rpc/{name}", method="POST", body=body)

    def claim_job(self, worker_id, lease_seconds):
        rows = self.rpc("klui_claim_document_job", {
            "p_worker_id": worker_id,
            "p_lease_seconds": lease_seconds,
        })
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
            self.request("document_chunks", method="POST", body=chunks[i:i + 250], prefer="return=minimal")

    def insert_pages(self, pages):
        if not pages:
            return
        for i in range(0, len(pages), 100):
            self.request("document_pages", method="POST", body=pages[i:i + 100], prefer="return=minimal")

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


class JinaEmbeddings:
    def __init__(self):
        self.api_key = env("JINA_API_KEY")
        self.model = env("DOCUMENT_VISUAL_EMBED_MODEL", "jina-embeddings-v5-omni-nano")
        self.dimensions = 768
        self.endpoint = env("JINA_EMBEDDINGS_URL", "https://api.jina.ai/v1/embeddings")

    @property
    def enabled(self):
        return bool(self.api_key)

    def _embedding_literal(self, values):
        if not values:
            return None
        floats = [float(value) for value in values]
        if len(floats) != 768:
            raise RuntimeError(f"unexpected_embedding_dimensions: got {len(floats)}, expected 768")
        return "[" + ",".join(f"{value:.8g}" for value in floats) + "]"

    def embed_images(self, image_paths, batch_size=4):
        if not self.enabled or not image_paths:
            return [None for _ in image_paths]

        embeddings = [None for _ in image_paths]
        indexed_paths = [
            (index, Path(path))
            for index, path in enumerate(image_paths)
            if Path(path).stat().st_size <= 5 * 1024 * 1024
        ]
        for start in range(0, len(indexed_paths), batch_size):
            batch = indexed_paths[start:start + batch_size]
            inputs = []
            for _, path in batch:
                encoded = base64.b64encode(path.read_bytes()).decode("ascii")
                inputs.append({"bytes": encoded})

            body = {
                "model": self.model,
                "normalized": True,
                "embedding_type": "float",
                "dimensions": self.dimensions,
                "input": inputs,
            }
            response = requests.post(
                self.endpoint,
                headers={
                    "authorization": f"Bearer {self.api_key}",
                    "content-type": "application/json",
                },
                data=json.dumps(body),
                timeout=120,
            )
            if not response.ok:
                raise RuntimeError(f"Jina embeddings failed: {response.status_code} {response.text[:500]}")

            data = response.json().get("data") or []
            by_index = {int(item.get("index", index)): item.get("embedding") for index, item in enumerate(data)}
            for index in range(len(batch)):
                original_index = batch[index][0]
                embeddings[original_index] = self._embedding_literal(by_index.get(index))

        return embeddings


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
        )

    def download(self, key, path):
        self.client.download_file(self.bucket, key, str(path))

    def upload(self, key, path, content_type):
        self.client.upload_file(
            str(path),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        head = self.client.head_object(Bucket=self.bucket, Key=key)
        return str(head.get("ETag", "")).strip('"')


class Processor:
    def __init__(self):
        self.db = Supabase()
        self.r2 = R2()
        self.embeddings = JinaEmbeddings()
        self.worker_id = f"document-worker-{uuid.uuid4()}"
        self.lease_seconds = int(env("DOCUMENT_JOB_TIMEOUT_MS", "120000")) // 1000
        self.poll_seconds = float(env("DOCUMENT_WORKER_POLL_SECONDS", "1.5"))
        self.max_extracted_chars = int(env("DOCUMENT_MAX_EXTRACTED_CHARS", "500000"))
        self.visual_page_dpi = int(env("DOCUMENT_VISUAL_PAGE_DPI", "144"))
        self.default_limits = {
            "max_pdf_pages": int(env("DOCUMENT_MAX_PDF_PAGES", "100")),
            "max_docx_words": int(env("DOCUMENT_MAX_DOCX_WORDS", "80000")),
            "max_xlsx_sheets": int(env("DOCUMENT_MAX_XLSX_SHEETS", "25")),
            "max_xlsx_cells": int(env("DOCUMENT_MAX_XLSX_CELLS", "250000")),
            "max_csv_rows": int(env("DOCUMENT_MAX_CSV_ROWS", "100000")),
            "max_csv_columns": int(env("DOCUMENT_MAX_CSV_COLUMNS", "100")),
            "max_extracted_chars": self.max_extracted_chars,
        }

    def object_key(self, user_id, file_name):
        return f"users/{user_id}/{uuid.uuid4()}/{safe_name(file_name)}"

    def run(self):
        print(f"{self.worker_id} started", flush=True)
        while True:
            try:
                job = self.db.claim_job(self.worker_id, self.lease_seconds)
                if not job:
                    time.sleep(self.poll_seconds)
                    continue
                self.handle_job(job)
            except Exception as exc:
                print(f"worker loop error: {exc}", flush=True)
                time.sleep(self.poll_seconds)

    def handle_job(self, job):
        job_id = job["id"]
        tmp = Path(tempfile.mkdtemp(prefix=f"doc-job-{job_id}-"))
        try:
            output = self.dispatch(job, tmp)
            self.db.update_job(job_id, {
                "status": "succeeded",
                "output": output,
                "finished_at": now_iso(),
                "lease_until": None,
            }, self.worker_id)
        except Exception as exc:
            error = {"message": str(exc), "code": getattr(exc, "code", "worker_error")}
            self.db.update_job(job_id, {
                "status": "failed",
                "error": error,
                "finished_at": now_iso(),
                "lease_until": None,
            }, self.worker_id)
            doc_id = job.get("document_file_id")
            if doc_id:
                self.db.update_document_file(doc_id, {
                    "processing_status": "failed",
                    "error": error,
                })
            print(f"job {job_id} failed: {exc}", flush=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def dispatch(self, job, tmp):
        job_type = job["job_type"]
        if job_type.startswith("document.extract."):
            return self.extract_job(job, tmp)
        if job_type.startswith("document.create."):
            return self.create_job(job, tmp)
        if job_type.startswith("document.edit."):
            return self.edit_job(job, tmp)
        if job_type.startswith("document.export."):
            return self.export_job(job, tmp)
        raise RuntimeError(f"Unsupported job type: {job_type}")

    def extract_job(self, job, tmp):
        doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        self.r2.download(attachment["object_key"], source)
        limits = {**self.default_limits, **((job.get("input") or {}).get("limits") or {})}
        if doc["kind"] == "pdf":
            return self.extract_pdf_visual_job(job, tmp, doc, attachment, source, limits)

        chunks, meta = self.extract(source, doc["kind"], doc["user_id"], doc["id"], limits)
        extraction = {
            "metadata": meta,
            "chunks": [{k: v for k, v in chunk.items() if k not in ("user_id", "document_file_id")} for chunk in chunks],
        }
        extraction_path = tmp / "extraction.json"
        extraction_path.write_text(json.dumps(extraction, ensure_ascii=False), encoding="utf-8")
        extraction_key = self.object_key(doc["user_id"], f"{Path(attachment['file_name']).stem}.extraction.json")
        self.r2.upload(extraction_key, extraction_path, "application/json")
        self.db.delete_chunks(doc["id"])
        self.db.delete_pages(doc["id"])
        self.db.insert_chunks(chunks)
        self.db.update_document_file(doc["id"], {
            "processing_status": "ready",
            "page_count": meta.get("page_count"),
            "word_count": meta.get("word_count"),
            "sheet_count": meta.get("sheet_count"),
            "used_cell_count": meta.get("used_cell_count"),
            "extraction_key": extraction_key,
            "source_etag": attachment.get("etag"),
            "metadata": meta,
            "error": None,
        })
        return {"document_file_id": doc["id"], "status": "ready", **meta}

    def extract_pdf_visual_job(self, job, tmp, doc, attachment, source, limits):
        self.db.update_document_file(doc["id"], {
            "processing_status": "processing",
            "metadata": {
                "mode": "visual_pages",
                "progress": 2,
                "stage": "validating",
                "file_name": attachment["file_name"],
                "content_type": attachment["content_type"],
                "size_bytes": attachment["size_bytes"],
            },
        })

        reader = PdfReader(str(source))
        if reader.is_encrypted:
            raise RuntimeError("password_protected")
        page_count = len(reader.pages)
        max_pages = self.limit(limits, "max_pdf_pages", 100)
        if page_count > max_pages:
            raise RuntimeError(f"too_many_pages: PDF has {page_count} pages; limit is {max_pages}")

        text_by_page = self.extract_pdf_page_text(source, page_count)
        render_dir = tmp / "pages"
        render_dir.mkdir(parents=True, exist_ok=True)
        image_paths = self.render_pdf_pages(source, render_dir, self.limit(limits, "visual_page_dpi", self.visual_page_dpi))
        if len(image_paths) < page_count:
            raise RuntimeError(f"pdf_render_failed: expected {page_count} pages, rendered {len(image_paths)}")

        self.db.update_document_file(doc["id"], {
            "metadata": {
                "mode": "visual_pages",
                "progress": 35,
                "stage": "embedding",
                "page_count": page_count,
                "embedding_model": self.embeddings.model if self.embeddings.enabled else None,
            },
        })

        warnings = []
        try:
            embeddings = self.embeddings.embed_images(image_paths[:page_count]) if self.embeddings.enabled else [None] * page_count
        except Exception as exc:
            warnings.append({"code": "embedding_failed", "message": str(exc)})
            embeddings = [None] * page_count

        pages = []
        total_words = 0
        for index, image_path in enumerate(image_paths[:page_count], start=1):
            if not self.db.get_document_file(doc["id"]):
                raise RuntimeError("document_deleted")
            page = reader.pages[index - 1]
            text = text_by_page.get(index, "")
            total_words += len(text.split())
            key = f"users/{doc['user_id']}/documents/{doc['id']}/pages/page-{index:04d}.jpg"
            self.r2.upload(key, image_path, "image/jpeg")
            width_px, height_px = self.estimated_page_pixels(page)
            pages.append({
                "user_id": doc["user_id"],
                "document_file_id": doc["id"],
                "page_number": index,
                "source_label": f"Page {index}",
                "image_key": key,
                "image_content_type": "image/jpeg",
                "width_px": width_px,
                "height_px": height_px,
                "text": truncate(text, 12000),
                "char_count": len(text),
                "token_estimate": max(1, len(text) // 4) if text else 0,
                "embedding": embeddings[index - 1],
                "embedding_model": self.embeddings.model if embeddings[index - 1] else None,
                "embedding_dimensions": 768 if embeddings[index - 1] else None,
                "metadata": {
                    "page": index,
                    "source_etag": attachment.get("etag"),
                },
            })
            if index == page_count or index % 5 == 0:
                progress = 35 + int((index / max(1, page_count)) * 55)
                self.db.update_document_file(doc["id"], {
                    "metadata": {
                        "mode": "visual_pages",
                        "progress": min(progress, 95),
                        "stage": "uploading_pages",
                        "page_count": page_count,
                        "pages_uploaded": index,
                        "embedding_model": self.embeddings.model if self.embeddings.enabled else None,
                        "warnings": warnings,
                    },
                })

        manifest = {
            "metadata": {
                "mode": "visual_pages",
                "page_count": page_count,
                "word_count": total_words,
                "embedding_model": self.embeddings.model if self.embeddings.enabled else None,
                "embedding_dimensions": 768 if any(page.get("embedding") for page in pages) else None,
                "warnings": warnings,
            },
            "pages": [
                {
                    "page_number": page["page_number"],
                    "source_label": page["source_label"],
                    "image_key": page["image_key"],
                    "width_px": page["width_px"],
                    "height_px": page["height_px"],
                    "char_count": page["char_count"],
                }
                for page in pages
            ],
        }
        extraction_path = tmp / "pdf-pages.json"
        extraction_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        extraction_key = self.object_key(doc["user_id"], f"{Path(attachment['file_name']).stem}.visual-pages.json")
        self.r2.upload(extraction_key, extraction_path, "application/json")

        self.db.delete_chunks(doc["id"])
        self.db.delete_pages(doc["id"])
        self.db.insert_pages(pages)

        meta = {
            "mode": "visual_pages",
            "progress": 100,
            "stage": "ready",
            "page_count": page_count,
            "word_count": total_words,
            "embedding_model": self.embeddings.model if self.embeddings.enabled else None,
            "embedding_dimensions": 768 if any(page.get("embedding") for page in pages) else None,
            "warnings": warnings,
        }
        self.db.update_document_file(doc["id"], {
            "processing_status": "ready",
            "page_count": page_count,
            "word_count": total_words,
            "extraction_key": extraction_key,
            "source_etag": attachment.get("etag"),
            "metadata": meta,
            "error": None,
        })
        return {"document_file_id": doc["id"], "status": "ready", **meta}

    def limit(self, limits, key, fallback):
        try:
            value = int((limits or {}).get(key, fallback))
            return value if value > 0 else fallback
        except (TypeError, ValueError):
            return fallback

    def cap_chunks(self, chunks, limits):
        max_chars = self.limit(limits, "max_extracted_chars", self.max_extracted_chars)
        capped = []
        total = 0
        for chunk in chunks:
            text = chunk.get("text") or ""
            if total >= max_chars:
                break
            remaining = max_chars - total
            if len(text) > remaining:
                chunk = {**chunk, "text": truncate(text, remaining)}
                chunk["char_count"] = len(chunk["text"])
                chunk["token_estimate"] = max(1, len(chunk["text"]) // 4)
            capped.append(chunk)
            total += len(chunk.get("text") or "")
        return capped

    def extract(self, path, kind, user_id, document_file_id, limits=None):
        limits = {**self.default_limits, **(limits or {})}
        if kind == "pdf":
            chunks, meta = self.extract_pdf(path, user_id, document_file_id, limits)
            return self.cap_chunks(chunks, limits), meta
        if kind == "docx":
            chunks, meta = self.extract_docx(path, user_id, document_file_id, limits)
            return self.cap_chunks(chunks, limits), meta
        if kind == "xlsx":
            chunks, meta = self.extract_xlsx(path, user_id, document_file_id, limits)
            return self.cap_chunks(chunks, limits), meta
        if kind == "pptx":
            chunks, meta = self.extract_pptx(path, user_id, document_file_id, limits)
            return self.cap_chunks(chunks, limits), meta
        if kind in ("csv", "tsv"):
            chunks, meta = self.extract_csv(path, kind, user_id, document_file_id, limits)
            return self.cap_chunks(chunks, limits), meta
        raise RuntimeError(f"Unsupported document kind: {kind}")

    def chunk(self, user_id, document_file_id, index, source_type, label, text, metadata=None):
        text = truncate(text, 12000)
        return {
            "user_id": user_id,
            "document_file_id": document_file_id,
            "chunk_index": index,
            "source_type": source_type,
            "source_label": label,
            "text": text,
            "char_count": len(text),
            "token_estimate": max(1, len(text) // 4),
            "metadata": metadata or {},
        }

    def extract_pdf_page_text(self, path, page_count):
        text_by_page = {}
        try:
            with pdfplumber.open(str(path)) as pdf:
                for i, page in enumerate(pdf.pages[:page_count], start=1):
                    text_by_page[i] = page.extract_text() or ""
        except Exception as exc:
            print(f"pdf text layer extraction failed: {exc}", flush=True)
        return text_by_page

    def render_pdf_pages(self, path, output_dir, dpi=None):
        prefix = output_dir / "page"
        render_dpi = max(72, min(int(dpi or self.visual_page_dpi), 180))
        subprocess.run(
            [
                "pdftoppm",
                "-jpeg",
                "-jpegopt",
                "quality=85",
                "-r",
                str(render_dpi),
                str(path),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        def page_number(file_path):
            match = re.search(r"-(\d+)\.jpe?g$", file_path.name, re.I)
            return int(match.group(1)) if match else 0

        return sorted(output_dir.glob("page-*.jpg"), key=page_number)

    def estimated_page_pixels(self, page):
        try:
            width_pt = float(page.mediabox.width)
            height_pt = float(page.mediabox.height)
            scale = max(72, min(self.visual_page_dpi, 180)) / 72
            return max(1, round(width_pt * scale)), max(1, round(height_pt * scale))
        except Exception:
            return None, None

    def extract_pdf(self, path, user_id, document_file_id, limits):
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise RuntimeError("password_protected")
        page_count = len(reader.pages)
        max_pages = self.limit(limits, "max_pdf_pages", 100)
        if page_count > max_pages:
            raise RuntimeError(f"too_many_pages: PDF has {page_count} pages; limit is {max_pages}")
        chunks = []
        low_text = 0
        total_words = 0
        with pdfplumber.open(str(path)) as pdf:
            for i, page in enumerate(pdf.pages[:page_count], start=1):
                text = page.extract_text() or ""
                if len(text.strip()) < 30:
                    low_text += 1
                total_words += len(text.split())
                if text.strip():
                    chunks.append(self.chunk(user_id, document_file_id, len(chunks), "page", f"Page {i}", text, {"page": i}))
                for table_index, table in enumerate(page.extract_tables() or [], start=1):
                    rows = ["\t".join("" if cell is None else str(cell) for cell in row) for row in table[:50]]
                    if rows:
                        chunks.append(self.chunk(user_id, document_file_id, len(chunks), "table", f"Page {i} table {table_index}", "\n".join(rows), {"page": i, "table": table_index}))
        meta = {"page_count": page_count, "word_count": total_words}
        if page_count and low_text / page_count > 0.6:
            meta["warning"] = "needs_ocr"
        return chunks[:1000], meta

    def extract_docx(self, path, user_id, document_file_id, limits):
        doc = Document(str(path))
        chunks = []
        buffer = []
        words = 0
        section = "Document"
        max_words = self.limit(limits, "max_docx_words", 80000)
        for paragraph in doc.paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            words += len(text.split())
            if words > max_words:
                raise RuntimeError(f"too_many_words: DOCX exceeds {max_words} extracted words")
            style = paragraph.style.name if paragraph.style else ""
            if style.lower().startswith("heading"):
                if buffer:
                    chunks.append(self.chunk(user_id, document_file_id, len(chunks), "paragraph", section, "\n".join(buffer)))
                    buffer = []
                section = text[:120]
            else:
                buffer.append(text)
                if sum(len(x) for x in buffer) > 6000:
                    chunks.append(self.chunk(user_id, document_file_id, len(chunks), "paragraph", section, "\n".join(buffer)))
                    buffer = []
        if buffer:
            chunks.append(self.chunk(user_id, document_file_id, len(chunks), "paragraph", section, "\n".join(buffer)))
        for table_index, table in enumerate(doc.tables, start=1):
            rows = []
            for row in table.rows[:80]:
                rows.append("\t".join(cell.text.strip() for cell in row.cells))
            if rows:
                chunks.append(self.chunk(user_id, document_file_id, len(chunks), "table", f"Table {table_index}", "\n".join(rows), {"table": table_index}))
        return chunks[:1000], {"word_count": words}

    def extract_xlsx(self, path, user_id, document_file_id, limits):
        wb = load_workbook(str(path), read_only=True, data_only=False)
        max_sheets = self.limit(limits, "max_xlsx_sheets", 25)
        max_cells = self.limit(limits, "max_xlsx_cells", 250000)
        if len(wb.worksheets) > max_sheets:
            raise RuntimeError(f"too_many_sheets: workbook has {len(wb.worksheets)} sheets; limit is {max_sheets}")
        chunks = []
        used_cells = 0
        for sheet in wb.worksheets:
            rows = []
            for row in sheet.iter_rows(max_row=200, max_col=50, values_only=False):
                values = []
                empty = True
                for cell in row:
                    value = cell.value
                    if value is not None:
                        empty = False
                        used_cells += 1
                        if used_cells > max_cells:
                            raise RuntimeError(f"too_many_cells: workbook exceeds {max_cells} non-empty cells")
                    values.append("" if value is None else str(value))
                if not empty:
                    rows.append("\t".join(values).rstrip())
                if len(rows) >= 200:
                    break
            if rows:
                chunks.append(self.chunk(user_id, document_file_id, len(chunks), "sheet", sheet.title, "\n".join(rows), {"sheet": sheet.title}))
        return chunks, {"sheet_count": len(wb.worksheets), "used_cell_count": used_cells}

    def extract_pptx(self, path, user_id, document_file_id, limits):
        prs = Presentation(str(path))
        chunks = []
        words = 0
        for slide_index, slide in enumerate(prs.slides, start=1):
            texts = []
            for shape in slide.shapes:
                if getattr(shape, "has_text_frame", False) and shape.text_frame:
                    text = "\n".join(p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip())
                    if text:
                        texts.append(text)
                if getattr(shape, "has_table", False):
                    rows = []
                    for row in shape.table.rows:
                        rows.append("\t".join(cell.text.strip() for cell in row.cells))
                    if rows:
                        chunks.append(self.chunk(user_id, document_file_id, len(chunks), "table", f"Slide {slide_index} table", "\n".join(rows), {"slide": slide_index}))
            slide_text = "\n".join(texts).strip()
            if slide_text:
                words += len(slide_text.split())
                chunks.append(self.chunk(user_id, document_file_id, len(chunks), "slide", f"Slide {slide_index}", slide_text, {"slide": slide_index}))
        return chunks[:500], {"page_count": len(prs.slides), "word_count": words, "slide_count": len(prs.slides)}

    def extract_csv(self, path, kind, user_id, document_file_id, limits):
        detected = from_path(str(path)).best()
        encoding = detected.encoding if detected else "utf-8"
        delimiter = "\t" if kind == "tsv" else ","
        max_rows = self.limit(limits, "max_csv_rows", 100000)
        max_columns = self.limit(limits, "max_csv_columns", 100)
        chunks = []
        rows = []
        row_count = 0
        with open(path, "r", encoding=encoding, errors="replace", newline="") as handle:
            reader = csv.reader(handle, delimiter=delimiter)
            for row in reader:
                row_count += 1
                if row_count > max_rows:
                    raise RuntimeError(f"too_many_rows: file exceeds {max_rows} rows")
                if len(row) > max_columns:
                    raise RuntimeError(f"too_many_columns: file has {len(row)} columns; limit is {max_columns}")
                rows.append("\t".join(row))
                if len(rows) >= 200:
                    chunks.append(self.chunk(user_id, document_file_id, len(chunks), "table", f"Rows {row_count - len(rows) + 1}-{row_count}", "\n".join(rows), {"rows": [row_count - len(rows) + 1, row_count]}))
                    rows = []
        if rows:
            chunks.append(self.chunk(user_id, document_file_id, len(chunks), "table", f"Rows {row_count - len(rows) + 1}-{row_count}", "\n".join(rows), {"rows": [row_count - len(rows) + 1, row_count]}))
        return chunks[:1000], {"row_count": row_count}

    def create_job(self, job, tmp):
        input_data = job.get("input") or {}
        fmt = input_data.get("format") or job["job_type"].split(".")[-1]
        title = input_data.get("title") or "Generated document"
        if fmt == "docx":
            path = self.create_js_artifact(tmp, title, input_data, "docx") or self.create_docx(tmp, title, input_data)
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif fmt == "xlsx":
            path = self.create_js_artifact(tmp, title, input_data, "xlsx") or self.create_xlsx(tmp, title, input_data)
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fmt == "pdf":
            path = self.create_pdf(tmp, title, input_data)
            content_type = "application/pdf"
        elif fmt == "pptx":
            path = self.create_js_artifact(tmp, title, input_data, "pptx") or self.create_pptx(tmp, title, input_data)
            content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            raise RuntimeError(f"Unsupported create format: {fmt}")
        return self.store_generated(job, tmp, path, fmt, content_type, "generated", None)

    def create_js_artifact(self, tmp, title, input_data, fmt):
        if not USE_JS_ARTIFACT_GENERATOR:
            return None
        generator = Path(NODE_ARTIFACT_GENERATOR)
        if not generator.exists():
            return None
        payload = dict(input_data or {})
        payload["format"] = fmt
        payload["title"] = title
        input_path = tmp / f"artifact-input-{uuid.uuid4()}.json"
        outdir = tmp / f"artifact-out-{uuid.uuid4()}"
        outdir.mkdir(exist_ok=True)
        input_path.write_text(json.dumps(payload), encoding="utf-8")
        cmd = [NODE_BIN, str(generator), str(input_path), str(outdir)]
        try:
            result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
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
        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        rows = input_data.get("data", {}).get("rows") if isinstance(input_data.get("data"), dict) else None
        if not rows:
            rows = [["Title", title], ["Instructions", input_data.get("instructions") or ""]]
        for row in rows[:1000]:
            ws.append(row if isinstance(row, list) else [row])
        path = tmp / f"{safe_name(title)}.xlsx"
        wb.save(path)
        return path

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

    def create_pdf(self, tmp, title, input_data):
        path = tmp / f"{safe_name(title)}.pdf"
        fonts = register_pdf_fonts()
        doc = SimpleDocTemplate(
            str(path),
            pagesize=letter,
            leftMargin=54,
            rightMargin=54,
            topMargin=54,
            bottomMargin=54,
        )
        styles = getSampleStyleSheet()
        styles["Title"].fontName = fonts["bold"]
        styles["Title"].fontSize = 20
        styles["Title"].leading = 24
        styles["Title"].spaceAfter = 12
        styles["Heading1"].fontName = fonts["bold"]
        styles["Heading1"].fontSize = 15
        styles["Heading1"].leading = 19
        styles["Heading1"].spaceBefore = 10
        styles["Heading1"].spaceAfter = 6
        styles["Heading2"].fontName = fonts["bold"]
        styles["Heading2"].fontSize = 13
        styles["Heading2"].leading = 16
        styles["Heading2"].spaceBefore = 8
        styles["Heading2"].spaceAfter = 5
        styles["Normal"].fontName = fonts["regular"]
        styles["Normal"].fontSize = 10.5
        styles["Normal"].leading = 14
        callout_style = ParagraphStyle(
            "KluiCallout",
            parent=styles["Normal"],
            fontName=fonts["regular"],
            fontSize=10.5,
            leading=14,
            leftIndent=10,
            rightIndent=10,
            spaceBefore=4,
            spaceAfter=10,
            borderColor=colors.HexColor("#CBD5E1"),
            borderWidth=0.5,
            borderPadding=8,
            backColor=colors.HexColor("#F8FAFC"),
        )
        story = [Paragraph(title, styles["Title"]), Spacer(1, 12)]
        summary = (input_data.get("data") or {}).get("summary") or (input_data.get("data") or {}).get("recommendation") or input_data.get("recommendation")
        if summary:
            story.append(Paragraph(f"<b>Key takeaway:</b> {xml_escape(clean_markdown(str(summary)))}", callout_style))
            story.append(Spacer(1, 8))
        body = strip_duplicate_title_heading(artifact_content(input_data), title)
        if body:
            self.append_pdf_markdown(story, body, styles, fonts)
        else:
            for block in (input_data.get("instructions") or "").split("\n\n"):
                if block.strip():
                    story.append(Paragraph(xml_escape(clean_markdown(block)).replace("\n", "<br/>"), styles["Normal"]))
                    story.append(Spacer(1, 8))
        for section in input_data.get("sections") or []:
            heading = section.get("heading") or section.get("title")
            content = section.get("content") or section.get("text") or ""
            if heading:
                story.append(Paragraph(xml_escape(str(heading)), styles["Heading2"]))
                story.append(Spacer(1, 6))
            if content:
                self.append_pdf_markdown(story, str(content), styles, fonts)
        for table in input_data.get("tables") or []:
            self.append_pdf_table(story, table, styles, fonts)
        def draw_footer(canvas, document):
            canvas.saveState()
            canvas.setFont(fonts["regular"], 8)
            canvas.setFillColor(colors.grey)
            canvas.drawRightString(letter[0] - 54, 24, f"Page {document.page}")
            canvas.restoreState()

        doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
        return path

    def append_pdf_markdown(self, story, text, styles, fonts):
        code_style = ParagraphStyle(
            "KluiCode",
            parent=styles["Code"],
            fontName=fonts["mono"],
            fontSize=9,
            leading=12,
            backColor=colors.whitesmoke,
            borderColor=colors.lightgrey,
            borderWidth=0.25,
            borderPadding=6,
            leftIndent=8,
            rightIndent=8,
            spaceBefore=4,
            spaceAfter=8,
        )
        in_code = False
        code_lines = []
        lines = str(text or "").splitlines()
        index = 0
        while index < len(lines):
            raw_line = lines[index]
            line = raw_line.strip()
            if line.startswith("```"):
                if in_code:
                    story.append(Preformatted(xml_escape(normalize_math_symbols("\n".join(code_lines)).strip()), code_style))
                    story.append(Spacer(1, 6))
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
                story.append(Spacer(1, 6))
                index += 1
                continue
            table_data, next_index = collect_markdown_table(lines, index)
            if table_data:
                self.append_pdf_table(story, table_data, styles, fonts)
                index = next_index
                continue
            if re.match(r"^-{3,}$", line):
                story.append(Spacer(1, 8))
                index += 1
                continue
            heading = re.match(r"^(#{1,3})\s+(.+)$", line)
            if heading:
                style = styles["Heading1"] if len(heading.group(1)) == 1 else styles["Heading2"]
                story.append(Paragraph(xml_escape(clean_markdown(heading.group(2))), style))
                story.append(Spacer(1, 6))
                index += 1
                continue
            bullet = re.match(r"^[-*]\s+(.+)$", line)
            if bullet:
                story.append(Paragraph(f"- {xml_escape(clean_markdown(bullet.group(1)))}", styles["Normal"]))
                story.append(Spacer(1, 4))
                index += 1
                continue
            numbered = re.match(r"^(\d+[.)])\s+(.+)$", line)
            if numbered:
                story.append(Paragraph(f"{xml_escape(numbered.group(1))} {xml_escape(clean_markdown(numbered.group(2)))}", styles["Normal"]))
                story.append(Spacer(1, 4))
                index += 1
                continue
            story.append(Paragraph(xml_escape(clean_markdown(line)), styles["Normal"]))
            story.append(Spacer(1, 6))
            index += 1
        if in_code and code_lines:
            story.append(Preformatted(xml_escape(normalize_math_symbols("\n".join(code_lines)).strip()), code_style))
            story.append(Spacer(1, 6))

    def append_pdf_table(self, story, table_data, styles, fonts):
        title = table_data.get("title") or table_data.get("caption")
        if title:
            story.append(Paragraph(xml_escape(str(title)), styles["Heading2"]))
            story.append(Spacer(1, 6))
        rows = table_data.get("rows") or table_data.get("data") or []
        headers = table_data.get("headers") or []
        if headers:
            rows = [headers] + rows
        if not rows:
            return
        width = max(len(row) if isinstance(row, list) else 1 for row in rows)
        table_style = ParagraphStyle(
            "KluiTableCell",
            parent=styles["Normal"],
            fontName=fonts["regular"],
            fontSize=8.5,
            leading=11,
            wordWrap="CJK",
        )
        clean_rows = [
            [
                Paragraph(xml_escape(clean_markdown(str(cell))).replace("\n", "<br/>"), table_style)
                for cell in normalize_table_row_width(row if isinstance(row, list) else [row], width)
            ]
            for row in rows[:50]
        ]
        col_widths = self.pdf_table_col_widths(rows[:50], width)
        table = Table(clean_rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
            ("FONTNAME", (0, 0), (-1, 0), fonts["bold"]),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(table)
        story.append(Spacer(1, 10))

    def pdf_table_col_widths(self, rows, width):
        if width <= 0:
            return None
        max_width = letter[0] - 108
        samples = []
        for col in range(width):
            lengths = []
            for row in rows:
                values = normalize_table_row_width(row if isinstance(row, list) else [row], width)
                lengths.append(min(len(str(values[col] or "")), 80))
            samples.append(max([8] + lengths))
        total = sum(samples) or width
        raw = [max_width * (sample / total) for sample in samples]
        min_width = min(72, max_width / width)
        widths = [max(min_width, value) for value in raw]
        scale = max_width / sum(widths)
        return [value * scale for value in widths]

    def edit_job(self, job, tmp):
        source_doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(source_doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        self.r2.download(attachment["object_key"], source)
        kind = source_doc["kind"]
        if kind == "docx":
            output = self.edit_docx(source, tmp, job.get("input") or {})
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif kind == "xlsx":
            output = self.edit_xlsx(source, tmp, job.get("input") or {})
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            raise RuntimeError("Editing this document type is not supported yet.")
        return self.store_generated(job, tmp, output, kind, content_type, "edited", source_doc)

    def edit_docx(self, source, tmp, input_data):
        doc = Document(str(source))
        operations = input_data.get("operations") or []
        changed = False
        for op in operations:
            find = str(op.get("find") or op.get("old_text") or "")
            replace = str(op.get("replace") or op.get("new_text") or "")
            if not find:
                continue
            for paragraph in doc.paragraphs:
                if find in paragraph.text:
                    paragraph.text = paragraph.text.replace(find, replace)
                    changed = True
        instructions = input_data.get("instructions") or ""
        if instructions and not changed:
            doc.add_page_break()
            doc.add_heading("Requested edits", level=1)
            doc.add_paragraph(instructions)
        output = tmp / f"edited-{source.name}"
        doc.save(output)
        return output

    def edit_xlsx(self, source, tmp, input_data):
        wb = load_workbook(str(source))
        operations = input_data.get("operations") or []
        for op in operations:
            sheet_name = op.get("sheet") or wb.sheetnames[0]
            cell = op.get("cell")
            value = op.get("value", op.get("formula"))
            if not cell:
                continue
            ws = wb[sheet_name] if sheet_name in wb.sheetnames else wb.active
            ws[str(cell)] = value
        if not operations and input_data.get("instructions"):
            ws = wb.create_sheet("Requested edits")
            ws["A1"] = input_data.get("instructions")
        output = tmp / f"edited-{source.name}"
        wb.save(output)
        return output

    def export_job(self, job, tmp):
        source_doc = self.db.get_document_file(job["document_file_id"])
        attachment = self.db.get_attachment(source_doc["attachment_id"])
        source = tmp / safe_name(attachment["file_name"])
        self.r2.download(attachment["object_key"], source)
        target = (job.get("input") or {}).get("target_format") or "pdf"
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
        key = self.object_key(user_id, path.name)
        etag = self.r2.upload(key, path, content_type)
        attachment = self.db.create_attachment({
            "user_id": user_id,
            "conversation_id": job.get("conversation_id"),
            "message_id": job.get("message_id"),
            "category": "document",
            "object_key": key,
            "file_name": path.name,
            "content_type": content_type,
            "size_bytes": path.stat().st_size,
            "etag": etag,
            "status": "uploaded",
            "uploaded_at": now_iso(),
        })
        document_file = self.db.create_document_file({
            "attachment_id": attachment["id"],
            "user_id": user_id,
            "conversation_id": job.get("conversation_id"),
            "message_id": job.get("message_id"),
            "kind": kind,
            "source": source,
            "parent_document_id": parent_doc["id"] if parent_doc else None,
            "version_no": int(parent_doc.get("version_no", 0)) + 1 if parent_doc else 1,
            "source_etag": etag,
            "processing_status": "processing",
            "metadata": {"generated_by_job": job["id"], **({"preview": True} if preview else {})},
        })
        chunks, meta = self.extract(path, kind, user_id, document_file["id"])
        self.db.insert_chunks(chunks)
        self.db.update_document_file(document_file["id"], {
            "processing_status": "ready",
            "page_count": meta.get("page_count"),
            "word_count": meta.get("word_count"),
            "sheet_count": meta.get("sheet_count"),
            "used_cell_count": meta.get("used_cell_count"),
            "metadata": {**meta, "generated_by_job": job["id"], **({"preview": True} if preview else {})},
        })
        return {
            "attachment_id": attachment["id"],
            "document_file_id": document_file["id"],
            "file_name": attachment["file_name"],
            "kind": kind,
            "status": "ready",
            **({"preview": True} if preview else {}),
            "download_url": f"/api/attachments/{attachment['id']}/download",
        }


if __name__ == "__main__":
    Processor().run()
