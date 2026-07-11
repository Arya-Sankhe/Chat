import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from worker import worker as w


class EnvHelpersTest(unittest.TestCase):
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


class SplitPageRangesTest(unittest.TestCase):
    def test_single_range_when_workers_not_justified(self):
        self.assertEqual(w.split_page_ranges(3, 2), [(1, 3)])
        self.assertEqual(w.split_page_ranges(10, 1), [(1, 10)])
        self.assertEqual(w.split_page_ranges(0, 2), [])

    def test_splits_evenly_when_justified(self):
        self.assertEqual(w.split_page_ranges(10, 2), [(1, 5), (6, 10)])
        self.assertEqual(w.split_page_ranges(11, 3), [(1, 4), (5, 8), (9, 11)])
        self.assertEqual(w.split_page_ranges(8, 4), [(1, 2), (3, 4), (5, 6), (7, 8)])


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
        self.assertIn("lease_until", captured["body"])
        self.assertNotIn("status", captured["body"])
        self.assertNotIn("output", captured["body"])

    def test_processor_stops_when_heartbeat_loses_ownership(self):
        import threading

        processor = w.Processor.__new__(w.Processor)
        processor._lease_lost = threading.Event()
        processor._lease_lost.set()
        with self.assertRaises(w.LeaseLostError):
            processor.assert_job_lease()

    def test_heartbeat_stops_before_an_unrenewed_lease_expires(self):
        import threading

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


class JinaBatchOrderingTest(unittest.TestCase):
    def test_embed_images_preserves_order_with_parallel_batches(self):
        embeddings = w.JinaEmbeddings.__new__(w.JinaEmbeddings)
        embeddings.api_key = "test"
        embeddings.model = "model"
        embeddings.dimensions = 768
        embeddings.endpoint = "https://example.test/embeddings"
        embeddings.batch_size = 2
        embeddings.batch_concurrency = 2
        embeddings.max_attempts = 1

        def embed_batch(batch):
            return [(original_index, f"emb-{original_index}") for original_index, _ in batch]

        embeddings._embed_batch = embed_batch

        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for index in range(5):
                path = Path(tmp) / f"page-{index}.jpg"
                path.write_bytes(b"x" * 10)
                paths.append(path)
            result = embeddings.embed_images(paths, batch_size=2, batch_concurrency=2)

        self.assertEqual(result, ["emb-0", "emb-1", "emb-2", "emb-3", "emb-4"])


class HealthcheckTest(unittest.TestCase):
    def test_healthcheck_requires_pdftoppm(self):
        from worker import healthcheck

        def fake_which(name):
            if name == "pdftoppm":
                return None
            return "/usr/bin/" + name

        with mock.patch("worker.healthcheck.shutil.which", side_effect=fake_which):
            self.assertEqual(healthcheck.main(), 1)

        with mock.patch("worker.healthcheck.shutil.which", side_effect=lambda name: "/bin/" + name):
            self.assertEqual(healthcheck.main(), 0)


if __name__ == "__main__":
    unittest.main()
