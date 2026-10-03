import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from openpyxl import Workbook

from worker import ingest
from worker import worker as w


class VisualReasonTest(unittest.TestCase):
    def test_text_pages_go_in_as_text(self):
        self.assertEqual(ingest.visual_reason("Plain prose. " * 40, {"image_coverage": 0.0, "path_objects": 3, "objects": 60}), "")

    def test_pictures_scans_and_charts_are_visual(self):
        self.assertEqual(ingest.visual_reason("", {"image_coverage": 0.97, "path_objects": 0, "objects": 1}), "image")
        self.assertEqual(ingest.visual_reason("Figure 1 " * 30, {"image_coverage": 0.0, "path_objects": 40, "objects": 90}), "graphics")
        self.assertEqual(ingest.visual_reason("", {"image_coverage": 0.0, "path_objects": 4, "objects": 12}), "no_text")

    def test_blank_page_is_not_visual(self):
        self.assertEqual(ingest.visual_reason("", {"image_coverage": 0.0, "path_objects": 0, "objects": 0}), "")

    def test_maths_tables_and_broken_text_layers_are_visual(self):
        self.assertEqual(ingest.visual_reason("Let ∑ xᵢ ≤ ∫ f(x) dx ≈ α β γ " * 3, {}), "math")
        self.assertEqual(ingest.visual_reason("(cid:12)(cid:15) words " * 20, {}), "garbled_text")
        layout = "\n".join(f"Item {i}     {i * 3}      {i * 7}     {i * 11}" for i in range(10))
        self.assertEqual(ingest.visual_reason("Item rows " * 30, {}, layout), "table")

    def test_a_simple_diagram_is_visual(self):
        labels = "Valve routing diagram. Use the connector paths to see which valve feeds which tank. " * 3
        self.assertEqual(ingest.visual_reason(labels, {"image_coverage": 0.0, "path_objects": 10, "objects": 19}), "graphics")
        # A prose page with a few rules stays text.
        self.assertEqual(ingest.visual_reason("Plain prose. " * 200, {"image_coverage": 0.0, "path_objects": 10, "objects": 30}), "")

    def test_two_column_prose_is_not_a_table(self):
        layout = "\n".join("Left column words here        Right column words here" for _ in range(20))
        self.assertEqual(ingest.visual_reason("prose " * 100, {}, layout), "")


class PageTextTest(unittest.TestCase):
    def test_pdftotext_pages_match_the_page_count(self):
        self.assertEqual(ingest.split_pdftotext_pages("a\fb\f", 2), ["a", "b"])
        self.assertEqual(ingest.split_pdftotext_pages("a\fb\fc", 2), None)

    def test_tidy_keeps_words_and_drops_margins(self):
        self.assertEqual(ingest.tidy_page_text("    Title\n\n\n\n    Body line   \n"), "Title\n\nBody line")

    def test_page_index_entry_keeps_the_first_words(self):
        entry = ingest.page_index_entry(3, "Page 3", "  Chapter\n two   begins " + "x" * 200, True)
        self.assertEqual(entry["start"][:20], "Chapter two begins x")
        self.assertEqual(len(entry["start"]), ingest.PAGE_INDEX_CHARS)
        self.assertTrue(entry["visual"])


class SlideMapTest(unittest.TestCase):
    def test_pages_map_onto_every_slide_or_the_visible_ones(self):
        slides = [{"number": 1, "hidden": False}, {"number": 2, "hidden": True}, {"number": 3, "hidden": False}]
        self.assertEqual([slide["number"] for slide in ingest.map_slides_to_pages(slides, 3)], [1, 2, 3])
        self.assertEqual([slide["number"] for slide in ingest.map_slides_to_pages(slides, 2)], [1, 3])
        self.assertEqual(ingest.map_slides_to_pages(slides, 5), [None] * 5)
        self.assertEqual(ingest.slide_label(slides[1], 2), "Slide 2 (hidden in the presentation)")
        self.assertEqual(ingest.slide_label(None, 4), "Slide 4")

    def test_unhide_slides_shows_every_slide_in_a_copy(self):
        from pptx import Presentation

        with tempfile.TemporaryDirectory() as tmp:
            source, shown = Path(tmp) / "deck.pptx", Path(tmp) / "shown.pptx"
            prs = Presentation()
            for title in ("One", "Two", "Three"):
                prs.slides.add_slide(prs.slide_layouts[5]).shapes.title.text = title
            prs.slides[1]._element.set("show", "0")
            prs.save(source)
            self.assertTrue(ingest.unhide_slides(source, shown))
            self.assertEqual([slide["hidden"] for slide in ingest.pptx_slides(shown)], [False, False, False])
            self.assertEqual([slide["hidden"] for slide in ingest.pptx_slides(source)], [False, True, False])
            plain = Path(tmp) / "plain.pptx"
            self.assertFalse(ingest.unhide_slides(shown, plain))
            self.assertFalse(plain.exists())


class OcrTest(unittest.TestCase):
    def test_only_pages_without_usable_text_are_read_by_ocr(self):
        self.assertTrue(ingest.needs_ocr({"visual_reason": "image", "text": ""}))
        self.assertTrue(ingest.needs_ocr({"visual_reason": "no_text", "text": " "}))
        self.assertTrue(ingest.needs_ocr({"visual_reason": "garbled_text", "text": "(cid:3)" * 40}))
        self.assertFalse(ingest.needs_ocr({"visual_reason": "image", "text": "A photo caption with plenty of real words on the page."}))
        self.assertFalse(ingest.needs_ocr({"visual_reason": "graphics", "text": ""}))
        self.assertFalse(ingest.needs_ocr({"visual_reason": "", "text": ""}))

    @unittest.skipIf(shutil.which("tesseract") is None or shutil.which("pdftoppm") is None, "needs tesseract (the worker image)")
    def test_ocr_reads_a_rendered_scan(self):
        from PIL import Image, ImageDraw, ImageFont

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.png"
            image = Image.new("RGB", (1200, 400), "white")
            font = ImageFont.truetype("DejaVuSans.ttf", 48)
            ImageDraw.Draw(image).text((60, 150), "Torque 147 Nm LOCK-070", fill="black", font=font)
            image.save(path)
            text = ingest.ocr_image(path, 144)
        self.assertIn("147", text)
        self.assertIn("LOCK-070", text)


    def test_ocr_failures_are_none_not_empty_text(self):
        self.assertIsNone(ingest.ocr_image("/no/such/page.png", 300))
        cmd = ingest.ocr_render_command("in.pdf", "out/ocr-0003", 3, 300)
        self.assertEqual(cmd[:5], ["pdftoppm", "-gray", "-png", "-r", "300"])
        self.assertIn("-singlefile", cmd)
        self.assertEqual(cmd[cmd.index("-f") + 1], "3")
        self.assertEqual(ingest.ocr_render_command("a", "b", 1, 9999)[4], "400")
        # OCR renders at the scan's own resolution: never upscaled past it, never below 150.
        self.assertEqual(ingest.ocr_dpi_for(100), 100)
        self.assertEqual(ingest.ocr_dpi_for(150), 144)
        self.assertEqual(ingest.ocr_dpi_for(600), 144)
        self.assertEqual(ingest.ocr_dpi_for(50), 72)
        self.assertEqual(ingest.ocr_dpi_for(None), 144)
        self.assertEqual(ingest.ocr_dpi_for(300, max_dpi=300), 300)

    @unittest.skipIf(shutil.which("tesseract") is None or shutil.which("pdftoppm") is None, "needs tesseract (the worker image)")
    def test_small_print_is_read_from_a_separate_high_resolution_render(self):
        from PIL import Image, ImageDraw, ImageFont

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            # An image-only A4 scan at 300 DPI with 7-point text.
            image = Image.new("RGB", (2480, 3508), "white")
            font = ImageFont.truetype("DejaVuSans.ttf", 29)
            draw = ImageDraw.Draw(image)
            for row, line in enumerate(["Batch B8Q7-4Z19 total 193.47", "Offset -12.5 reserve LOT-6Y0K-31"]):
                draw.text((200, 300 + row * 60), line, fill="black", font=font)
            pdf = tmp / "scan.pdf"
            image.save(pdf, "PDF", resolution=300)
            self.assertEqual(ingest.page_scan_ppi(pdf), {1: 300})
            text = ingest.ocr_pdf_page(pdf, 1, tmp, ingest.ocr_dpi_for(300))
            self.assertEqual(list(tmp.glob("ocr-*.png")), [])
        self.assertIn("B8Q7-4Z19", text)
        self.assertIn("193.47", text)
        self.assertIn("-12.5", text)
        self.assertIsNone(ingest.ocr_pdf_page(Path("/no/such.pdf"), 1, "/tmp", 300))


class SpreadsheetRowsTest(unittest.TestCase):
    def test_every_row_is_kept_with_its_real_row_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.title = "Sales"
            ws.append(["region", "q1", "total"])
            for i in range(450):
                ws.append([f"r{i}", i, f"=B{i + 2}*2"])
            ws["A900"] = "note\twith\ttabs\nand a newline"
            wb.save(path)
            sheets, extra = ingest.read_xlsx_sheets(path, 25, 250000)

        sheet = sheets[0]
        rows = [row for block in sheet.blocks for row in block["rows"]]
        self.assertEqual(rows[:3], [1, 2, 3])
        self.assertEqual(rows[-1], 900)
        self.assertEqual(len(rows), 452)
        self.assertEqual(sheet.summary()["header"], ["region", "q1", "total"])
        self.assertEqual(sheet.summary()["preview"][1], {"row": 2, "cells": "r0\t0\t=B2*2"})
        last_line = sheet.blocks[-1]["lines"][-1]
        self.assertEqual(last_line, "note with tabs\\nand a newline")
        self.assertEqual(extra["used_cell_count"], 3 + 450 * 3 + 1)

    def test_formula_shows_its_cached_value_when_the_cache_is_trusted(self):
        self.assertEqual(ingest.cell_text(1234.0), "1234")
        self.assertEqual(ingest.cell_text(0.1), "0.1")
        self.assertEqual(ingest.cell_text(True), "TRUE")

    def test_blocks_hold_whole_rows(self):
        blocks = ingest.SheetBlocks("S")
        for row in range(1, 451):
            blocks.add(row, [f"r{row}", "x"])
        blocks.finish()
        self.assertEqual([len(block["rows"]) for block in blocks.blocks], [200, 200, 50])

    def test_csv_quotes_and_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.csv"
            path.write_text('a,b\n1,"x,y"\n\n3,"multi\nline"\n', encoding="utf-8")
            sheets, extra = ingest.read_delimited_sheet(path, "csv", 100, 10)
            chunks = ingest.sheet_chunks(sheets, lambda *args: {"text": args[3], "meta": args[4]})
            self.assertEqual(chunks[0]["text"], "a\tb\n1\tx,y\n3\tmulti\\nline")
            self.assertEqual(chunks[0]["meta"]["row_numbers"], [1, 2, 4])
            with self.assertRaisesRegex(RuntimeError, "too_many_rows"):
                ingest.read_delimited_sheet(path, "csv", 2, 10)
            with self.assertRaisesRegex(RuntimeError, "too_many_columns"):
                ingest.read_delimited_sheet(path, "csv", 100, 1)


def fake_processor():
    processor = w.Processor.__new__(w.Processor)
    processor.db = mock.Mock()
    processor.db.request.return_value = []
    processor.r2 = mock.Mock()
    processor.visual_page_dpi = 72
    processor.pdf_render_workers = 1
    processor.page_upload_workers = 2
    processor.default_limits = {"max_pdf_pages": 150}
    processor.pdf_render_workers = 2
    processor.ocr_dpi = ingest.OCR_DPI
    processor.assert_job_active = mock.Mock()
    processor._lease_lost = None
    return processor


@unittest.skipIf(shutil.which("soffice") is None or shutil.which("pdftoppm") is None, "needs LibreOffice and poppler (the worker image)")
class PagedIngestTest(unittest.TestCase):
    def test_extract_job_stores_every_page_with_text_and_image_and_one_ready_stamp(self):
        from docx import Document

        processor = fake_processor()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = tmp / "report.docx"
            doc = Document()
            doc.add_heading("Quarterly report", 1)
            for i in range(45):
                doc.add_paragraph(f"Paragraph {i}: revenue grew in every region this quarter.")
            doc.add_paragraph("Model: ∑ xᵢ ≤ ∫ f(x) dx ≈ α β γ → ∞")
            doc.save(source)

            document = {"id": "doc-1", "user_id": "user-1", "attachment_id": "att-1", "kind": "docx", "metadata": {"editable": False, "generated_by": "chat", "ocr_pages": [9], "stage": "queued"}, "processing_status": "pending"}
            attachment = {"id": "att-1", "file_name": "report.docx", "object_key": "k", "content_type": "docx", "size_bytes": 10, "etag": "e1"}
            processor.db.get_document_file.return_value = document
            processor.db.get_attachment.return_value = attachment
            processor.r2.download.side_effect = lambda key, path: shutil.copy(source, path)
            job_tmp = tmp / "job"
            job_tmp.mkdir()
            output = processor.extract_job({"id": "job-1", "document_file_id": "doc-1", "input": {}}, job_tmp)

        patch = output["_document_patch"]
        self.assertEqual(patch["text_ready_at"], patch["visual_ready_at"])
        meta = patch["metadata"]
        self.assertEqual(meta["pipeline"], "pages-v1")
        self.assertEqual(meta["ingest_version"], ingest.INGEST_VERSION)
        # A re-ingest keeps other features' flags and drops what ingest derived before.
        self.assertEqual(meta["generated_by"], "chat")
        self.assertNotIn("ocr_pages", meta)
        self.assertEqual(meta["stage"], "ready")
        page_count = meta["page_count"]
        self.assertGreaterEqual(page_count, 2)
        pages = processor.db.insert_pages.call_args.args[0]
        chunks = processor.db.insert_chunks.call_args.args[0]
        self.assertEqual([row["page_number"] for row in pages], list(range(1, page_count + 1)))
        self.assertEqual([chunk["chunk_index"] for chunk in chunks], list(range(page_count)))
        self.assertTrue(all(row["image_key"].endswith(f"page-{row['page_number']:04d}.jpg") for row in pages))
        self.assertEqual(processor.r2.upload.call_count, page_count)
        self.assertIn("Quarterly report", chunks[0]["text"])
        self.assertIn("Paragraph 44", "\n".join(chunk["text"] for chunk in chunks))
        self.assertIn(page_count, meta["visual_pages"])
        self.assertEqual(chunks[-1]["metadata"]["visual_reason"], "math")
        self.assertEqual(len(meta["page_index"]), page_count)
        self.assertNotIn("_image_path", pages[0])
        # Rows past the new end are removed, so a re-ingest never leaves stale pages behind.
        deletes = [call for call in processor.db.request.call_args_list if call.kwargs.get("method") == "DELETE"]
        self.assertEqual(deletes[0].kwargs["params"]["chunk_index"], f"gte.{page_count}")


class SpreadsheetIngestTest(unittest.TestCase):
    def test_spreadsheet_ingest_stores_rows_and_sheet_summaries(self):
        processor = fake_processor()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            wb = Workbook()
            wb.active.title = "Budget"
            wb.active.append(["item", "cost"])
            wb.active.append(["rent", 1200])
            wb.create_sheet("Notes").append(["note", "keep receipts"])
            wb.save(path)
            meta = processor.ingest_document(
                {"id": "doc-2", "user_id": "user-1", "kind": "xlsx", "metadata": {}},
                {"file_name": "book.xlsx"},
                path,
                Path(tmp),
                {"max_xlsx_sheets": 25, "max_xlsx_cells": 1000},
            )

        chunks = processor.db.insert_chunks.call_args.args[0]
        self.assertEqual(meta["pipeline"], "sheets-v1")
        self.assertEqual([sheet["name"] for sheet in meta["sheets"]], ["Budget", "Notes"])
        self.assertEqual(chunks[0]["text"], "item\tcost\nrent\t1200")
        self.assertEqual(chunks[0]["metadata"]["row_numbers"], [1, 2])
        self.assertEqual(chunks[1]["metadata"]["sheet"], "Notes")
        processor.db.update_document_file.assert_called_with("doc-2", {"sheet_count": 2, "used_cell_count": 6})

    def test_an_empty_spreadsheet_fails_instead_of_looking_ready(self):
        processor = fake_processor()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "empty.csv"
            path.write_text("\n\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "empty_document"):
                processor.ingest_document({"id": "d", "user_id": "u", "kind": "csv", "metadata": {}}, {}, path, Path(tmp), {})


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(shutil.which("soffice") is None or shutil.which("pdftoppm") is None, "needs LibreOffice and poppler (the worker image)")
class HiddenSlideIngestTest(unittest.TestCase):
    def test_hidden_slides_are_stored_with_their_own_page_and_label(self):
        from pptx import Presentation
        from pptx.util import Inches

        processor = fake_processor()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = tmp / "briefing.pptx"
            prs = Presentation()
            for body in ("Visible opening", "Reserve 73 code HIDDEN-94Z", "Visible close"):
                slide = prs.slides.add_slide(prs.slide_layouts[6])
                slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)).text_frame.text = body
            prs.slides[1]._element.set("show", "0")
            prs.save(source)
            work = tmp / "work"
            work.mkdir()
            meta = processor.ingest_document(
                {"id": "doc-3", "user_id": "user-1", "kind": "pptx", "metadata": {}},
                {"file_name": "briefing.pptx"},
                source,
                work,
                {},
            )

        chunks = processor.db.insert_chunks.call_args.args[0]
        self.assertEqual(meta["page_count"], 3)
        self.assertEqual(meta["hidden_slides"], [2])
        self.assertNotIn("hidden_slides_missing", meta)
        self.assertEqual(chunks[1]["source_label"], "Slide 2 (hidden in the presentation)")
        self.assertTrue(chunks[1]["metadata"]["hidden"])
        self.assertIn("HIDDEN-94Z", chunks[1]["text"])
