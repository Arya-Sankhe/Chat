import sys
import types
import unittest

# The service imports boto3/requests at module load; the logic under test needs neither.
for name in ("boto3", "requests", "botocore", "botocore.config", "botocore.exceptions"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["requests"].Session = object
sys.modules["requests"].RequestException = Exception
sys.modules["botocore.config"].Config = object
sys.modules["botocore.exceptions"].ClientError = Exception

from transcriber import service  # noqa: E402


class FakeR2:
    def __init__(self, failing=()):
        self.deleted, self.failing = [], set(failing)

    def delete(self, key):
        if key in self.failing:
            raise RuntimeError("r2 down")
        self.deleted.append(key)


class FakeDb:
    def __init__(self, attachment=None, error=None, due=()):
        self.attachment, self.error, self.due = attachment, error, list(due)
        self.calls = []

    def rpc(self, name, body, attempts=4):
        self.calls.append((name, body))
        return self.due if name == "klui_claim_audio_object_cleanup" else None

    def get_attachment(self, _attachment_id):
        if self.error:
            raise self.error
        return self.attachment


def make(db):
    worker = service.Service.__new__(service.Service)
    worker.db, worker.r2 = db, FakeR2()
    return worker


class DiscardUploadTest(unittest.TestCase):
    job = {"attachment_id": "att-1"}

    def test_keeps_audio_the_attachment_already_points_at(self):
        worker = make(FakeDb({"object_key": "users/u/audio/new.m4a"}))
        worker.discard_upload(self.job, "users/u/audio/new.m4a")
        self.assertEqual(worker.r2.deleted, [])

    def test_deletes_audio_that_was_never_published(self):
        worker = make(FakeDb({"object_key": "users/u/orig.mp3"}))
        worker.discard_upload(self.job, "users/u/audio/new.m4a")
        self.assertEqual(worker.r2.deleted, ["users/u/audio/new.m4a"])

    def test_keeps_audio_when_ownership_cannot_be_checked(self):
        worker = make(FakeDb(error=RuntimeError("network down")))
        worker.discard_upload(self.job, "users/u/audio/new.m4a")
        self.assertEqual(worker.r2.deleted, [])


class CleanupListTest(unittest.TestCase):
    def test_deleted_objects_come_off_the_list_and_failures_stay(self):
        worker = make(FakeDb(due=["users/u/a.m4a", "users/u/b.mp3"]))
        worker.queue = "production"
        worker.r2 = FakeR2(failing={"users/u/b.mp3"})
        worker.sweep_objects()
        self.assertEqual(worker.r2.deleted, ["users/u/a.m4a"])
        self.assertEqual(worker.db.calls[0], ("klui_claim_audio_object_cleanup", {"p_queue": "production", "p_limit": 50}))
        self.assertEqual(worker.db.calls[1], ("klui_finish_audio_object_cleanup", {"p_keys": ["users/u/a.m4a"]}))

    def test_unpublished_copy_is_deleted_and_taken_off_the_list(self):
        worker = make(FakeDb({"object_key": "users/u/orig.mp3"}))
        worker.discard_upload({"attachment_id": "att-1"}, "users/u/audio/new.m4a")
        self.assertEqual(worker.db.calls, [("klui_finish_audio_object_cleanup", {"p_keys": ["users/u/audio/new.m4a"]})])


class QueueNameTest(unittest.TestCase):
    def test_defaults_to_local(self):
        self.assertEqual(service.queue_name(""), "local")
        self.assertEqual(service.queue_name("prod jobs"), "local")
        self.assertEqual(service.queue_name("production"), "production")


if __name__ == "__main__":
    unittest.main()
