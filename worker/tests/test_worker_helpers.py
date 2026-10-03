import json
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from openpyxl import Workbook, load_workbook

from worker import worker as w


class EnvHelpersTest(unittest.TestCase):
    def test_document_worker_claim_passes_its_queue(self):
        db = w.Supabase.__new__(w.Supabase)
        db.rpc = mock.Mock(return_value=[{"id": "job-1", "queue": "local"}])
        self.assertEqual(db.claim_job("worker-1", 120, "local")["id"], "job-1")
        db.rpc.assert_called_once_with("klui_claim_document_job", {
            "p_worker_id": "worker-1", "p_lease_seconds": 120, "p_queue": "local"
        })

    def test_env_int_clamps_to_bounds(self):
        with mock.patch.dict(os.environ, {"TEST_INT": "99"}, clear=False):
            self.assertEqual(w.env_int("TEST_INT", 2, minimum=1, maximum=4), 4)
        with mock.patch.dict(os.environ, {"TEST_INT": "0"}, clear=False):
            self.assertEqual(w.env_int("TEST_INT", 2, minimum=1, maximum=4), 1)
        with mock.patch.dict(os.environ, {"TEST_INT": "nope"}, clear=False):
            self.assertEqual(w.env_int("TEST_INT", 2, minimum=1, maximum=4), 2)

    def test_default_lease_heartbeat_seconds(self):
        self.assertEqual(w.default_lease_heartbeat_seconds(120), 30.0)
        self.assertEqual(w.default_lease_heartbeat_seconds(8), 5.0)
        self.assertEqual(w.default_lease_heartbeat_seconds(200), 30.0)

    def test_worker_concurrency_default_and_cap(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DOCUMENT_WORKER_CONCURRENCY", None)
            self.assertEqual(w.worker_concurrency(), 1)
        with mock.patch.dict(os.environ, {"DOCUMENT_WORKER_CONCURRENCY": "100"}, clear=False):
            self.assertEqual(w.worker_concurrency(), w.WORKER_CONCURRENCY_CAP)

    def test_idle_backoff_ramps_then_holds_its_clock_slot(self):
        self.assertEqual(
            [w.idle_sleep_seconds(n, 10.0, 0.0, 0.0) for n in range(1, 4)], [1, 2, 5]
        )
        self.assertEqual(w.worker_idle_offset_seconds(0, 2, 10), 0)
        self.assertEqual(w.worker_idle_offset_seconds(1, 2, 10), 5)

        # Two loops that went idle at unrelated times (any job duration) must still land on
        # their own slot, so the pair stays half a period apart instead of drifting into
        # lockstep. 20s covers a configured maximum above the 1 -> 2 -> 5 ramp.
        for max_idle in (10.0, 20.0):
            offsets = [w.worker_idle_offset_seconds(i, 2, max_idle) for i in range(2)]
            for went_idle_at in (0.0, 7.0, 13.5, 37.0, 90.3):
                for offset in offsets:
                    sleep_for = w.idle_sleep_seconds(4, max_idle, offset, went_idle_at)
                    self.assertGreater(sleep_for, 0.0)
                    self.assertLessEqual(sleep_for, max_idle)
                    self.assertAlmostEqual((went_idle_at + sleep_for) % max_idle, offset)


class RetryHelpersTest(unittest.TestCase):
    def test_is_retryable_http_status(self):
        self.assertTrue(w.is_retryable_http_status(429))
        self.assertTrue(w.is_retryable_http_status(500))
        self.assertTrue(w.is_retryable_http_status(503))
        self.assertFalse(w.is_retryable_http_status(400))
        self.assertFalse(w.is_retryable_http_status(404))
        self.assertFalse(w.is_retryable_http_status(200))

    def test_request_with_retries_retries_429_then_succeeds(self):
        responses = [
            mock.Mock(ok=False, status_code=429, text="slow down"),
            mock.Mock(ok=True, status_code=200, text="{}"),
        ]
        with mock.patch("worker.worker.requests.request", side_effect=responses) as request_mock:
            with mock.patch("worker.worker.time.sleep") as sleep_mock:
                result = w.request_with_retries("GET", "https://example.test", max_attempts=3)
        self.assertIs(result, responses[1])
        self.assertEqual(request_mock.call_count, 2)
        sleep_mock.assert_called_once()

    def test_request_with_retries_does_not_retry_permanent_4xx(self):
        response = mock.Mock(ok=False, status_code=400, text="bad")
        with mock.patch("worker.worker.requests.request", return_value=response) as request_mock:
            with mock.patch("worker.worker.time.sleep") as sleep_mock:
                result = w.request_with_retries("GET", "https://example.test", max_attempts=4)
        self.assertIs(result, response)
        self.assertEqual(request_mock.call_count, 1)
        sleep_mock.assert_not_called()

    def test_request_with_retries_retries_network_errors(self):
        import requests

        responses = [
            requests.exceptions.ConnectionError("boom"),
            mock.Mock(ok=True, status_code=200, text="{}"),
        ]
        with mock.patch("worker.worker.requests.request", side_effect=responses) as request_mock:
            with mock.patch("worker.worker.time.sleep"):
                result = w.request_with_retries("GET", "https://example.test", max_attempts=3)
        self.assertTrue(result.ok)
        self.assertEqual(request_mock.call_count, 2)


class XlsxRecalculationTest(unittest.TestCase):
    def test_create_xlsx_recalculates_before_delivery(self):
        processor = w.Processor.__new__(w.Processor)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            recalculated = tmp_path / "recalculated" / "Budget.xlsx"
            processor.recalculate_xlsx = mock.Mock(return_value=recalculated)
            result = processor.create_xlsx(tmp_path, "Budget", {
                "data": {"sheets": [{"name": "Costs", "rows": [["Value"], [1]]}]}
            })
        self.assertEqual(result, recalculated)
        processor.recalculate_xlsx.assert_called_once()

    def test_recalculation_rejects_missing_formula_results(self):
        processor = w.Processor.__new__(w.Processor)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "formula.xlsx"
            workbook = Workbook()
            workbook.active["A1"] = "=1+1"
            workbook.save(source)

            def copy_without_recalculation(command, **_kwargs):
                output = tmp_path / "recalculated" / source.name
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, output)
                return mock.Mock(returncode=0)

            with mock.patch("worker.worker.subprocess.run", side_effect=copy_without_recalculation):
                with self.assertRaisesRegex(RuntimeError, "xlsx_formula_error"):
                    processor.recalculate_xlsx(source, tmp_path)


class SplitPageRangesTest(unittest.TestCase):
    def test_single_range_when_workers_not_justified(self):
        self.assertEqual(w.split_page_ranges(3, 2), [(1, 3)])
        self.assertEqual(w.split_page_ranges(10, 1), [(1, 10)])
        self.assertEqual(w.split_page_ranges(0, 2), [])

    def test_splits_evenly_when_justified(self):
        self.assertEqual(w.split_page_ranges(10, 2), [(1, 5), (6, 10)])
        self.assertEqual(w.split_page_ranges(11, 3), [(1, 4), (5, 8), (9, 11)])
        self.assertEqual(w.split_page_ranges(8, 4), [(1, 2), (3, 4), (5, 6), (7, 8)])



class PptxExtractionHelpersTest(unittest.TestCase):
    def test_pptx_notes_text_uses_notes_text_frame(self):
        frame = mock.Mock()
        frame.paragraphs = [
            mock.Mock(text="  Keep this note  "),
            mock.Mock(text="   "),
            mock.Mock(text="Second line"),
        ]
        notes_slide = mock.Mock(notes_text_frame=frame)
        slide = mock.Mock(has_notes_slide=True, notes_slide=notes_slide)
        self.assertEqual(w.pptx_notes_text(slide), "Keep this note\nSecond line")

        slide_no_notes = mock.Mock(has_notes_slide=False)
        self.assertEqual(w.pptx_notes_text(slide_no_notes), "")

class InsertPagesConflictTest(unittest.TestCase):
    def test_insert_pages_supports_ignore_duplicates(self):
        db = w.Supabase.__new__(w.Supabase)
        db.request = mock.Mock(return_value=None)
        db.insert_pages([{"document_file_id": "d", "page_number": 1}], on_conflict="ignore")
        kwargs = db.request.call_args.kwargs
        prefer = kwargs["prefer"]
        self.assertIn("ignore-duplicates", prefer)
        self.assertEqual(kwargs["params"], {"on_conflict": "document_file_id,page_number"})

    def test_insert_pages_defaults_to_merge(self):
        db = w.Supabase.__new__(w.Supabase)
        db.request = mock.Mock(return_value=None)
        db.insert_pages([{"document_file_id": "d", "page_number": 1}])
        kwargs = db.request.call_args.kwargs
        prefer = kwargs["prefer"]
        self.assertIn("merge-duplicates", prefer)
        self.assertEqual(kwargs["params"], {"on_conflict": "document_file_id,page_number"})

class PdftoppmCommandTest(unittest.TestCase):
    def test_page_range_flags(self):
        cmd = w.build_pdftoppm_command("/tmp/doc.pdf", "/tmp/out/page", 144, first=3, last=3)
        self.assertEqual(cmd[0], "pdftoppm")
        self.assertIn("-f", cmd)
        self.assertEqual(cmd[cmd.index("-f") + 1], "3")
        self.assertEqual(cmd[cmd.index("-l") + 1], "3")
        self.assertEqual(cmd[-2:], ["/tmp/doc.pdf", "/tmp/out/page"])

    def test_render_pdf_pages_uses_requested_range(self):
        processor = w.Processor.__new__(w.Processor)
        processor.visual_page_dpi = 144
        processor.pdf_render_workers = 2
        captured = {}

        def fake_run(cmd, check=True, stdout=None, stderr=None):
            captured["cmd"] = list(cmd)
            return mock.Mock()

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "page-7.jpg").write_bytes(b"x")
            with mock.patch("worker.worker.subprocess.run", side_effect=fake_run):
                paths = processor.render_pdf_pages(
                    "/tmp/doc.pdf",
                    out,
                    dpi=144,
                    page_count=1,
                    first_page=7,
                    last_page=7,
                )
        self.assertEqual([p.name for p in paths], ["page-7.jpg"])
        self.assertEqual(captured["cmd"][captured["cmd"].index("-f") + 1], "7")
        self.assertEqual(captured["cmd"][captured["cmd"].index("-l") + 1], "7")


class DispatchRoutingTest(unittest.TestCase):
    def test_pdf_creation_prints_the_document_engine_pdf_directly(self):
        processor = w.Processor.__new__(w.Processor)
        processor.create_js_artifact = mock.Mock()
        processor.create_docx = mock.Mock()
        processor.libreoffice_convert = mock.Mock()
        processor.store_generated = mock.Mock(return_value={"document_file_id": "doc-1"})
        job = {
            "id": "job-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "job_type": "document.create.pdf",
            "input": {
                "format": "pdf",
                "title": "Report",
                "editor_markdown": "# Report\n\nEditable body.",
            },
        }

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            pdf_path = tmp_path / "out" / "Report.pdf"
            processor.create_js_artifact.return_value = pdf_path

            result = processor.create_job(job, tmp_path)

        self.assertEqual(result, {"document_file_id": "doc-1"})
        processor.create_js_artifact.assert_called_once_with(
            tmp_path, "Report", job["input"], "pdf"
        )
        processor.create_docx.assert_not_called()
        processor.libreoffice_convert.assert_not_called()
        processor.store_generated.assert_called_once_with(
            job, tmp_path, pdf_path, "pdf", "application/pdf", "generated", None
        )

    def test_store_generated_keeps_editable_markdown_for_prose_documents(self):
        processor = w.Processor.__new__(w.Processor)
        processor.r2 = mock.Mock()
        processor.r2.upload.return_value = "etag-1"
        processor.db = mock.Mock()
        processor.db.reserve_attachment.return_value = {"id": "att-1", "file_name": "report.docx"}
        processor.db.complete_reserved_attachment.return_value = {"id": "att-1", "file_name": "report.docx", "etag": "etag-1"}
        processor.db.create_document_file.return_value = {"id": "doc-1"}
        processor.ingest_document = mock.Mock(return_value={"pipeline": "pages-v1", "word_count": 2, "page_count": 1})
        processor.default_limits = {}
        processor.artifact_preview = None
        processor.object_key = mock.Mock(return_value="users/u/report.docx")
        job = {
            "id": "job-1",
            "user_id": "user-1",
            "conversation_id": "conversation-1",
            "queue": "local",
            "input": {
                "editor_markdown": "# Report\n\nEditable body.",
                "account_max_bytes": 2684354560,
                "project_id": "project-1",
            },
        }

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "report.docx"
            output.write_bytes(b"docx")
            processor.store_generated(
                job, Path(tmp), output, "docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "generated", None,
            )

        created = processor.db.create_document_file.call_args.args[0]
        updated = processor.db.update_document_file.call_args.args[1]
        reserved = processor.db.reserve_attachment.call_args.args[0]
        completed = processor.db.complete_reserved_attachment.call_args.args[0]
        self.assertEqual(reserved["max_bytes"], 2684354560)
        self.assertEqual(reserved["project_id"], "project-1")
        self.assertEqual(completed["max_bytes"], 2684354560)
        self.assertEqual(created["project_id"], "project-1")
        self.assertEqual(created["queue"], "local")
        self.assertTrue(created["metadata"]["editable"])
        self.assertEqual(updated["metadata"]["editor_markdown"], "# Report\n\nEditable body.")
        self.assertEqual(updated["metadata"]["editor_revision"], 1)

    def test_store_generated_uses_complete_attachment_not_document_upload(self):
        processor = w.Processor.__new__(w.Processor)
        processor.r2 = mock.Mock()
        processor.db = mock.Mock()
        order = []
        processor.db.reserve_attachment.side_effect = lambda payload: order.append("reserve") or {"id": "att-1"}
        processor.r2.upload.side_effect = lambda *args, **kwargs: order.append("upload") or "etag-1"
        processor.db.complete_reserved_attachment.side_effect = (
            lambda payload: order.append("complete") or {"id": "att-1", "file_name": "out.pdf", "etag": "etag-1"}
        )
        processor.db.create_document_file.return_value = {"id": "doc-1"}
        processor.ingest_document = mock.Mock(return_value={"pipeline": "pages-v1", "page_count": 1})
        processor.default_limits = {}
        processor.artifact_preview = None
        processor.object_key = mock.Mock(return_value="users/u/out.pdf")
        job = {"id": "job-1", "user_id": "user-1", "input": {"account_max_bytes": 100}}

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.pdf"
            output.write_bytes(b"pdf")
            processor.store_generated(job, Path(tmp), output, "pdf", "application/pdf", "generated", None)

        self.assertEqual(order, ["reserve", "upload", "complete"])
        processor.db.complete_reserved_attachment.assert_called_once()
        processor.db.complete_document_upload.assert_not_called()
        self.assertEqual(w.StorageQuotaError().code, "storage_exhausted")

    def test_store_generated_falls_back_to_max_cap_when_job_omits_account_max_bytes(self):
        processor = w.Processor.__new__(w.Processor)
        processor.r2 = mock.Mock()
        processor.r2.upload.return_value = "etag-1"
        processor.db = mock.Mock()
        processor.db.reserve_attachment.return_value = {"id": "att-1"}
        processor.db.complete_reserved_attachment.return_value = {"id": "att-1", "file_name": "out.pdf", "etag": "etag-1"}
        processor.db.create_document_file.return_value = {"id": "doc-1"}
        processor.ingest_document = mock.Mock(return_value={"pipeline": "pages-v1", "page_count": 1})
        processor.default_limits = {}
        processor.artifact_preview = None
        processor.object_key = mock.Mock(return_value="users/u/out.pdf")
        job = {"id": "job-1", "user_id": "user-1", "input": {}}

        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"PLAN_MAX_MAX_STORAGE_BYTES": "5368709120"}):
            output = Path(tmp) / "out.pdf"
            output.write_bytes(b"pdf")
            processor.store_generated(job, Path(tmp), output, "pdf", "application/pdf", "generated", None)

        self.assertEqual(processor.db.reserve_attachment.call_args.args[0]["max_bytes"], 5368709120)
        self.assertEqual(processor.db.complete_reserved_attachment.call_args.args[0]["max_bytes"], 5368709120)

    def test_store_generated_keeps_row_when_r2_rollback_fails(self):
        processor = w.Processor.__new__(w.Processor)
        processor.r2 = mock.Mock()
        processor.r2.upload.return_value = "etag-1"
        processor.r2.delete.side_effect = RuntimeError("R2 unavailable")
        processor.db = mock.Mock()
        processor.db.reserve_attachment.return_value = {"id": "att-1"}
        processor.db.complete_reserved_attachment.side_effect = w.StorageQuotaError()
        processor.ingest_document = mock.Mock(return_value={"pipeline": "pages-v1", "page_count": 1})
        processor.default_limits = {}
        processor.artifact_preview = None
        processor.object_key = mock.Mock(return_value="users/u/out.pdf")
        job = {"id": "job-1", "user_id": "user-1", "input": {"account_max_bytes": 100}}

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.pdf"
            output.write_bytes(b"pdf")
            with self.assertRaises(w.StorageQuotaError):
                processor.store_generated(job, Path(tmp), output, "pdf", "application/pdf", "generated", None)

        processor.db.delete_attachment.assert_not_called()

    def test_store_generated_rolls_back_when_ingest_fails_after_complete(self):
        processor = w.Processor.__new__(w.Processor)
        processor.r2 = mock.Mock()
        processor.r2.upload.return_value = "etag-1"
        processor.db = mock.Mock()
        processor.db.reserve_attachment.return_value = {"id": "att-1"}
        processor.db.complete_reserved_attachment.return_value = {"id": "att-1", "file_name": "out.pdf", "etag": "etag-1"}
        processor.db.create_document_file.return_value = {"id": "doc-1"}
        processor.ingest_document = mock.Mock(side_effect=RuntimeError("ingest failed"))
        processor.default_limits = {}
        processor.artifact_preview = None
        processor.object_key = mock.Mock(return_value="users/u/out.pdf")
        job = {"id": "job-1", "user_id": "user-1", "input": {"account_max_bytes": 100}}

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.pdf"
            output.write_bytes(b"pdf")
            with self.assertRaises(RuntimeError):
                processor.store_generated(job, Path(tmp), output, "pdf", "application/pdf", "generated", None)

        processor.r2.delete.assert_called_once_with("users/u/out.pdf")
        processor.db.delete_attachment.assert_called_once_with("user-1", "att-1")

    def test_dispatch_routes_ingest_and_retires_enrich_jobs(self):
        processor = w.Processor.__new__(w.Processor)
        processor.extract_job = mock.Mock(return_value={"ok": "extract"})
        processor.create_job = mock.Mock(return_value={"ok": "create"})
        tmp = Path("/tmp")

        self.assertEqual(processor.dispatch({"job_type": "document.extract.pdf"}, tmp)["ok"], "extract")
        self.assertEqual(processor.dispatch({"job_type": "document.create.docx"}, tmp)["ok"], "create")
        # Jobs queued by the old two-stage pipeline finish without doing anything.
        for job_type in ("document.enrich.pdf", "document.render_page"):
            self.assertEqual(processor.dispatch({"job_type": job_type}, tmp), {"status": "skipped", "reason": "single_ingest"})

    def test_handle_job_uses_complete_rpc_and_strips_document_patch(self):
        processor = w.Processor.__new__(w.Processor)
        processor.worker_id = "worker-a"
        processor.lease_seconds = 120
        processor.heartbeat_seconds = 30
        processor.db = mock.Mock()
        processor.db.complete_document_job.return_value = {"job": {"id": "job-1"}}
        processor._lease_heartbeat_loop = mock.Mock()
        processor.assert_job_active = mock.Mock()
        processor.dispatch = mock.Mock(return_value={
            "document_file_id": "doc-1",
            "status": "text_ready",
            "_document_patch": {"text_ready_at": "2026-07-11T00:00:00+00:00", "error": None},
        })

        with mock.patch("worker.worker.tempfile.mkdtemp", return_value=tempfile.mkdtemp()):
            with mock.patch("worker.worker.shutil.rmtree"):
                with mock.patch("worker.worker.threading.Thread") as thread_cls:
                    thread = mock.Mock()
                    thread_cls.return_value = thread
                    processor.handle_job({"id": "job-1", "document_file_id": "doc-1"})

        args = processor.db.complete_document_job.call_args.args
        self.assertEqual(args[0], "job-1")
        self.assertEqual(args[1], "worker-a")
        self.assertEqual(args[2]["status"], "text_ready")
        self.assertNotIn("_document_patch", args[2])
        self.assertEqual(args[3]["text_ready_at"], "2026-07-11T00:00:00+00:00")
        processor.db.fail_document_job.assert_not_called()
        processor.db.update_document_file.assert_not_called()

    def test_handle_job_fails_through_fail_rpc_without_direct_document_fail(self):
        processor = w.Processor.__new__(w.Processor)
        processor.worker_id = "worker-a"
        processor.lease_seconds = 120
        processor.heartbeat_seconds = 30
        processor.db = mock.Mock()
        processor.db.fail_document_job.return_value = {"job": {"id": "job-1"}}
        processor._lease_heartbeat_loop = mock.Mock()
        processor.dispatch = mock.Mock(side_effect=RuntimeError("boom"))

        with mock.patch("worker.worker.tempfile.mkdtemp", return_value=tempfile.mkdtemp()):
            with mock.patch("worker.worker.shutil.rmtree"):
                with mock.patch("worker.worker.threading.Thread") as thread_cls:
                    thread_cls.return_value = mock.Mock()
                    processor.handle_job({"id": "job-1", "document_file_id": "doc-1"})

        processor.db.fail_document_job.assert_called_once()
        error = processor.db.fail_document_job.call_args.args[2]
        self.assertEqual(error["message"], "boom")
        processor.db.update_document_file.assert_not_called()


class RenewJobLeaseTest(unittest.TestCase):
    def test_renew_job_lease_filters_running_and_worker(self):
        db = w.Supabase.__new__(w.Supabase)
        db.url = "https://example.test"
        db.key = "key"
        db.max_attempts = 1
        captured = {}

        def fake_request(path, method="GET", params=None, body=None, prefer=None):
            captured.update({
                "path": path,
                "method": method,
                "params": params,
                "body": body,
                "prefer": prefer,
            })
            return [{"id": "job-1", "status": "running"}]

        db.request = fake_request
        row = db.renew_job_lease("job-1", "worker-a", 120)
        self.assertEqual(row["id"], "job-1")
        self.assertEqual(captured["method"], "PATCH")
        self.assertEqual(captured["params"]["id"], "eq.job-1")
        self.assertEqual(captured["params"]["worker_id"], "eq.worker-a")
        self.assertEqual(captured["params"]["status"], "eq.running")
        self.assertTrue(captured["params"]["lease_until"].startswith("gte."))
        self.assertIn("lease_until", captured["body"])
        self.assertNotIn("status", captured["body"])
        self.assertNotIn("output", captured["body"])

    def test_processor_stops_when_heartbeat_loses_ownership(self):
        processor = w.Processor.__new__(w.Processor)
        processor._lease_lost = threading.Event()
        processor._lease_lost.set()
        with self.assertRaises(w.LeaseLostError):
            processor.assert_job_lease()

    def test_assert_job_active_honors_cancel_requested(self):
        processor = w.Processor.__new__(w.Processor)
        processor.worker_id = "worker-a"
        processor._lease_lost = threading.Event()
        processor.db = mock.Mock()
        processor.db.get_job.return_value = {
            "id": "job-1",
            "status": "running",
            "worker_id": "worker-a",
            "cancel_requested": True,
        }
        with self.assertRaises(w.JobCancelledError):
            processor.assert_job_active("job-1")

    def test_heartbeat_stops_before_an_unrenewed_lease_expires(self):
        processor = w.Processor.__new__(w.Processor)
        processor.worker_id = "worker-a"
        processor.lease_seconds = 120
        processor.heartbeat_seconds = 30
        processor.db = mock.Mock()
        processor.db.renew_job_lease.side_effect = RuntimeError("database unavailable")
        stop_event = mock.Mock()
        stop_event.wait.return_value = False
        lost_event = threading.Event()

        with mock.patch("worker.worker.time.monotonic", side_effect=[0, 91]):
            processor._lease_heartbeat_loop("job-1", stop_event, lost_event)

        self.assertTrue(lost_event.is_set())


class XlsxReadEditTest(unittest.TestCase):
    def test_edit_xlsx_uses_explicit_operations_and_rejects_unknown_sheets(self):
        processor = w.Processor.__new__(w.Processor)
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = directory / "book.xlsx"
            workbook = Workbook()
            workbook.active.title = "Budget"
            workbook.save(source)
            workbook.close()

            output = processor.edit_xlsx(source, directory, {
                "operations": [
                    {"type": "set_range", "sheet": "Budget", "range": "A1:B2", "values": [["Item", "Cost"], ["Hosting", 20]]},
                    {"type": "set_formula", "sheet": "Budget", "cell": "B3", "formula": "=SUM(B2:B2)"},
                    {"type": "set_number_format", "sheet": "Budget", "range": "B2:B3", "format": "$#,##0.00"},
                ]
            })
            edited = load_workbook(output, data_only=False)
            self.assertEqual(edited["Budget"]["A2"].value, "Hosting")
            self.assertIn(edited["Budget"]["B3"].value, {"=SUM(B2:B2)", "=SUM(B2)"})
            self.assertIn(edited["Budget"]["B2"].number_format, {"$#,##0.00", "\\$#,##0.00"})
            self.assertTrue(edited.calculation.fullCalcOnLoad)
            edited.close()

            with self.assertRaisesRegex(RuntimeError, "xlsx_sheet_not_found"):
                processor.edit_xlsx(source, directory, {
                    "operations": [{"type": "set_cell", "sheet": "Missing", "cell": "A1", "value": "wrong"}]
                })
            original = load_workbook(source)
            self.assertIsNone(original["Budget"]["A1"].value)
            original.close()


class SupabaseRetrySafetyTest(unittest.TestCase):
    def test_non_idempotent_posts_are_not_retried(self):
        db = w.Supabase.__new__(w.Supabase)
        db.url = "https://example.test"
        db.key = "key"
        db.max_attempts = 4
        response = mock.Mock(ok=True, status_code=201, text='[{"id":"row-1"}]')
        response.json.return_value = [{"id": "row-1"}]

        with mock.patch("worker.worker.request_with_retries", return_value=response) as request_mock:
            db.request("attachments", method="POST", body={"id": "row-1"})

        self.assertEqual(request_mock.call_args.kwargs["max_attempts"], 1)

    def test_idempotent_reads_use_configured_retries(self):
        db = w.Supabase.__new__(w.Supabase)
        db.url = "https://example.test"
        db.key = "key"
        db.max_attempts = 4
        response = mock.Mock(ok=True, status_code=200, text="[]")
        response.json.return_value = []

        with mock.patch("worker.worker.request_with_retries", return_value=response) as request_mock:
            db.request("document_files")

        self.assertEqual(request_mock.call_args.kwargs["max_attempts"], 4)


class R2UploadEtagTest(unittest.TestCase):
    def test_upload_uses_put_object_etag_without_head(self):
        r2 = w.R2.__new__(w.R2)
        r2.bucket = "bucket"
        client = mock.Mock()
        client.put_object.return_value = {"ETag": '"abc123"'}
        client.head_object.side_effect = AssertionError("HEAD should not be called")
        r2.client = client

        with tempfile.NamedTemporaryFile(delete=False) as handle:
            handle.write(b"hello")
            path = handle.name
        try:
            etag = r2.upload("key/path.bin", path, "application/octet-stream")
        finally:
            Path(path).unlink(missing_ok=True)

        self.assertEqual(etag, "abc123")
        client.put_object.assert_called_once()
        client.head_object.assert_not_called()
        client.upload_file.assert_not_called()

    def test_delete_removes_the_exact_r2_object(self):
        r2 = w.R2.__new__(w.R2)
        r2.bucket = "bucket"
        r2.client = mock.Mock()

        r2.delete("users/user-1/page.jpg")

        r2.client.delete_object.assert_called_once_with(
            Bucket="bucket",
            Key="users/user-1/page.jpg",
        )






class StorageRetryTest(unittest.TestCase):
    def test_busy_object_reads_retry_then_succeed(self):
        from botocore.exceptions import ClientError

        busy = ClientError({"Error": {"Code": "ServiceUnavailable", "Message": "Reduce your rate of simultaneous reads on the same object."}}, "GetObject")
        calls, sleeps = [], []

        def action():
            calls.append(1)
            if len(calls) < 3:
                raise busy
            return "ok"

        self.assertEqual(w.with_storage_retries(action, sleep=sleeps.append), "ok")
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(sleeps), 2)

    def test_missing_object_is_not_retried(self):
        from botocore.exceptions import ClientError

        missing = ClientError({"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}}, "GetObject")
        calls = []

        def action():
            calls.append(1)
            raise missing

        with self.assertRaises(ClientError):
            w.with_storage_retries(action, sleep=lambda _: None)
        self.assertEqual(len(calls), 1)


class PptxEditTest(unittest.TestCase):
    def make_deck(self, path):
        from pptx import Presentation
        from pptx.util import Inches

        prs = Presentation()
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
        paragraph = box.text_frame.paragraphs[0]
        first = paragraph.add_run()
        first.text = "Revenue grew "
        second = paragraph.add_run()
        second.text = "18% in Q3"
        second.font.bold = True
        other = prs.slides.add_slide(prs.slide_layouts[6])
        other.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)).text_frame.text = "Q3 outlook"
        prs.save(path)

    def texts(self, path):
        from pptx import Presentation

        return [" ".join(p.text for p in w.iter_pptx_paragraphs(slide.shapes)) for slide in Presentation(str(path)).slides]

    def test_replace_text_keeps_run_formatting_and_respects_slide_filter(self):
        from pptx import Presentation

        processor = w.Processor.__new__(w.Processor)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "deck.pptx"
            self.make_deck(source)
            output = processor.replace_pptx_text(source, tmp_path, [
                {"type": "replace_text", "find": "18%", "replace": "21%"},
                {"type": "replace_text", "find": "Q3", "replace": "Q4", "slide": 2},
                {"type": "replace_text", "find": "missing words", "replace": "x"},
            ])
            self.assertEqual(self.texts(output), ["Revenue grew 21% in Q3", "Q4 outlook"])
            runs = Presentation(str(output)).slides[0].shapes[0].text_frame.paragraphs[0].runs
            self.assertTrue(runs[1].font.bold)
            self.assertEqual(processor.artifact_warnings, ["text not found: missing words"])

    def test_replace_text_spanning_runs_and_nothing_found(self):
        processor = w.Processor.__new__(w.Processor)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "deck.pptx"
            self.make_deck(source)
            output = processor.replace_pptx_text(source, tmp_path, [{"type": "replace_text", "find": "grew 18%", "replace": "fell 2%"}])
            self.assertEqual(self.texts(output)[0], "Revenue fell 2% in Q3")
            with self.assertRaises(RuntimeError):
                processor.replace_pptx_text(source, tmp_path, [{"type": "replace_text", "find": "absent", "replace": "x"}])

    def test_replace_spanning_runs_keeps_formatting_of_later_runs(self):
        from pptx import Presentation
        from pptx.util import Inches

        prs = Presentation()
        paragraph = prs.slides.add_slide(prs.slide_layouts[6]).shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)).text_frame.paragraphs[0]
        for text, bold, italic in [("Revenue ", False, False), ("grew 18%", True, False), (" in Q3, ", False, False), ("a record", False, True), (" year", False, False)]:
            run = paragraph.add_run()
            run.text = text
            run.font.bold = bold
            run.font.italic = italic
        count = w.replace_in_paragraph(paragraph, "Revenue grew", "Sales rose")
        self.assertEqual(count, 1)
        runs = paragraph.runs
        self.assertEqual([run.text for run in runs], ["Sales rose", " 18%", " in Q3, ", "a record", " year"])
        self.assertTrue(runs[1].font.bold)
        self.assertTrue(runs[3].font.italic, "the italic phrase after the match keeps its formatting")
        self.assertFalse(bool(runs[4].font.italic))
        self.assertEqual(w.replace_in_paragraph(paragraph, "Q3, a", "Q4, the"), 1)
        self.assertEqual([run.text for run in paragraph.runs], ["Sales rose", " 18%", " in Q4, the", " record", " year"])
        self.assertTrue(paragraph.runs[3].font.italic)

    def test_generated_deck_edit_re_renders_from_spec(self):
        processor = w.Processor.__new__(w.Processor)
        deck = {"title": "Churn", "slides": [{"type": "cover", "title": "Churn"}]}
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            rendered = tmp_path / "out" / "Churn.pptx"
            rendered.parent.mkdir()
            rendered.write_bytes(b"pptx")

            def fake_render(tmp_arg, title, payload, fmt):
                self.assertEqual((title, fmt), ("Churn", "pptx"))
                self.assertEqual(payload, {"data": {"deck": deck}})
                processor.artifact_warnings = ["slide 2: clipped: x"]
                return rendered

            processor.create_js_artifact = fake_render
            output = processor.edit_pptx(tmp_path / "edited-edited-Churn.pptx", tmp_path, {"title": "Churn", "data": {"deck": deck}})
            self.assertEqual(output.name, "edited-Churn.pptx")
            self.assertEqual(output.read_bytes(), b"pptx")
            self.assertEqual(processor.artifact_warnings, ["slide 2: clipped: x"])

            processor.create_js_artifact = lambda *args: None
            with self.assertRaises(RuntimeError):
                processor.edit_pptx(tmp_path / "Churn.pptx", tmp_path, {"data": {"deck": deck}})


class HealthcheckTest(unittest.TestCase):
    def test_healthcheck_requires_pypdfium2(self):
        from worker import healthcheck

        with mock.patch("worker.healthcheck.importlib.util.find_spec", return_value=None):
            self.assertEqual(healthcheck.main(), 1)

    def test_healthcheck_requires_pdftoppm(self):
        from worker import healthcheck

        def fake_which(name):
            if name == "pdftoppm":
                return None
            return "/usr/bin/" + name

        with mock.patch("worker.healthcheck.importlib.util.find_spec", return_value=object()), \
             mock.patch("worker.healthcheck.shutil.which", side_effect=fake_which):
            self.assertEqual(healthcheck.main(), 1)

        with mock.patch("worker.healthcheck.importlib.util.find_spec", return_value=object()), \
             mock.patch("worker.healthcheck.shutil.which", side_effect=lambda name: "/bin/" + name):
            self.assertEqual(healthcheck.main(), 0)


if __name__ == "__main__":
    unittest.main()
