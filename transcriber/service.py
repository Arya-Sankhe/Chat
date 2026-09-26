"""Transcription queue worker for Dojo audio sources.

Strictly one job at a time. The queue lives in Postgres (transcription_jobs), so nothing
is lost if this container restarts: a job whose heartbeat stops is picked up again, up to
three attempts. Each job runs in a fresh child process, which frees all model memory the
moment it exits.
"""

import gc
import json
import os
import re
import resource
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import boto3
import requests
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from transcriber.shaping import build_chunks, build_lines, word_count

LEASE_SECONDS = 120
HEARTBEAT_SECONDS = 15
IDLE_MIN_SECONDS = 2.0
IDLE_MAX_SECONDS = 10.0
SWEEP_SECONDS = 300
EXIT_BAD_INPUT = 3


def env(name, default=""):
    return os.environ.get(name, default).strip()


def env_int(name, default):
    try:
        return int(env(name, str(default)))
    except ValueError:
        return default


def log(message, **fields):
    extra = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[transcriber] {message} {extra}".rstrip(), flush=True)


class Supabase:
    def __init__(self):
        self.url = env("SUPABASE_URL").rstrip("/")
        self.key = env("SUPABASE_SERVICE_ROLE_KEY")
        if not self.url or not self.key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": self.key,
            "authorization": f"Bearer {self.key}",
            "content-type": "application/json",
        })

    def rpc(self, name, body, attempts=4):
        for attempt in range(attempts):
            try:
                response = self.session.post(f"{self.url}/rest/v1/rpc/{name}", data=json.dumps(body), timeout=60)
            except requests.RequestException:
                if attempt + 1 >= attempts:
                    raise
                time.sleep(min(10, 0.5 * 2 ** attempt))
                continue
            if response.status_code >= 500 and attempt + 1 < attempts:
                time.sleep(min(10, 0.5 * 2 ** attempt))
                continue
            if not response.ok:
                raise RuntimeError(f"{name} failed: {response.status_code} {response.text[:500]}")
            return response.json() if response.text else None
        return None

    def get_attachment(self, attachment_id):
        response = self.session.get(
            f"{self.url}/rest/v1/attachments",
            params={"id": f"eq.{attachment_id}", "select": "id,user_id,object_key,content_type", "limit": "1"},
            timeout=30,
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None


class R2:
    def __init__(self):
        account_id = env("R2_ACCOUNT_ID")
        endpoint = env("R2_ENDPOINT") or (f"https://{account_id}.r2.cloudflarestorage.com" if account_id else "")
        self.bucket = env("R2_BUCKET")
        if not endpoint or not self.bucket:
            raise RuntimeError("R2 endpoint and bucket are required")
        self.client = boto3.client(
            "s3", endpoint_url=endpoint, region_name="auto",
            aws_access_key_id=env("R2_ACCESS_KEY_ID"), aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
            config=BotoConfig(retries={"mode": "adaptive", "max_attempts": 5}),
        )

    def download(self, key, path):
        self.client.download_file(self.bucket, key, str(path))

    def upload(self, key, path, content_type):
        with open(path, "rb") as handle:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=handle, ContentType=content_type)

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)


class JobFailed(Exception):
    def __init__(self, code, message, retryable):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


class Heartbeat(threading.Thread):
    """Keeps the lease alive and reports progress while the child works. Notices when the
    user deleted the source (or the lease was lost) so the child can be stopped."""

    def __init__(self, db, job_id, worker_id):
        super().__init__(daemon=True)
        self.db, self.job_id, self.worker_id = db, job_id, worker_id
        self.stage, self.progress, self.duration = "preparing", 0.0, None
        self.stop_event = threading.Event()
        self.lost = threading.Event()
        self.dirty = threading.Event()

    def update(self, stage=None, progress=None, duration=None):
        if stage:
            self.stage = stage
        if progress is not None:
            self.progress = progress
        if duration:
            self.duration = duration
        self.dirty.set()

    def run(self):
        last = 0.0
        while not self.stop_event.is_set():
            # Progress pushes at most every 4s; the lease renews at least every 15s.
            self.dirty.wait(timeout=HEARTBEAT_SECONDS)
            if self.stop_event.is_set():
                break
            if time.monotonic() - last < 4:
                self.stop_event.wait(4 - (time.monotonic() - last))
            self.dirty.clear()
            try:
                alive = self.db.rpc("klui_heartbeat_transcription_job", {
                    "p_job_id": self.job_id, "p_worker_id": self.worker_id, "p_lease_seconds": LEASE_SECONDS,
                    "p_stage": self.stage, "p_progress": round(float(self.progress), 4),
                    "p_duration_seconds": self.duration,
                }, attempts=2)
                last = time.monotonic()
                if alive is False:
                    self.lost.set()
                    return
            except Exception as error:  # A missed beat is fine; the lease has slack.
                log("heartbeat failed", error=str(error)[:200])

    def stop(self):
        self.stop_event.set()
        self.dirty.set()


def rss_mb(pid):
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    except (OSError, ValueError):
        pass
    return 0.0


def queue_name(value):
    value = value.lower()
    return value if re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", value) else "local"


def friendly_storage_error(text):
    if "project_storage_limit_exceeded" in text:
        return JobFailed("course_full", "This course is full. Remove some sources and retry.", False)
    if "account_storage_limit_exceeded" in text:
        return JobFailed("storage_full", "Your storage is full. Delete some files and retry.", False)
    if "transcription_cancelled" in text or "transcription_lease_lost" in text:
        return JobFailed("cancelled", "Transcription was cancelled.", False)
    return None


class Service:
    def __init__(self):
        self.db = Supabase()
        self.r2 = R2()
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self.work_root = Path(env("TRANSCRIBE_WORK_DIR", "/work"))
        self.max_child_rss = env_int("TRANSCRIBE_CHILD_MAX_RSS_MB", 2600)
        # Each machine claims only its own queue, so a laptop pointed at the production
        # database never picks up production lectures (and production never picks up its tests).
        self.queue = queue_name(env("TRANSCRIBE_QUEUE"))
        self.child = None
        self.next_sweep = 0.0
        self.current_job = None
        self.stopping = False

    def beat(self):
        try:
            (self.work_root / ".alive").touch()
        except OSError:
            pass

    def clean_work_root(self):
        self.work_root.mkdir(parents=True, exist_ok=True)
        for entry in self.work_root.iterdir():
            if entry.is_dir():
                shutil.rmtree(entry, ignore_errors=True)

    def handle_signal(self, signum, _frame):
        log("shutting down", signal=signum)
        self.stopping = True
        if self.child and self.child.poll() is None:
            self.child.kill()

    def run(self):
        signal.signal(signal.SIGTERM, self.handle_signal)
        signal.signal(signal.SIGINT, self.handle_signal)
        self.clean_work_root()
        log("ready", worker=self.worker_id, queue=self.queue, threads=env("TRANSCRIBE_THREADS", "4"))
        idle = IDLE_MIN_SECONDS
        while not self.stopping:
            self.beat()
            try:
                rows = self.db.rpc("klui_claim_transcription_job", {
                    "p_worker_id": self.worker_id, "p_lease_seconds": LEASE_SECONDS, "p_queue": self.queue,
                })
            except Exception as error:
                log("claim failed", error=str(error)[:200])
                rows = None
            job = rows[0] if rows else None
            if not job:
                if time.monotonic() >= self.next_sweep:
                    self.next_sweep = time.monotonic() + SWEEP_SECONDS
                    self.sweep_objects()
                time.sleep(idle)
                idle = min(IDLE_MAX_SECONDS, idle * 1.5)
                continue
            idle = IDLE_MIN_SECONDS
            self.process(job)
            # Everything the job touched is gone: child exited, files removed.
            gc.collect()
        log("stopped")

    def process(self, job):
        job_id = job["id"]
        work = self.work_root / job_id
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        heartbeat = Heartbeat(self.db, job_id, self.worker_id)
        heartbeat.start()
        new_key = None
        started = time.monotonic()
        log("job start", job=job_id, attempt=job.get("attempt_count"))
        try:
            attachment = self.db.get_attachment(job["attachment_id"])
            if not attachment:
                raise JobFailed("cancelled", "The source was removed.", False)
            source = work / "source"
            try:
                self.r2.download(attachment["object_key"], source)
            except ClientError as error:
                code = str(error.response.get("Error", {}).get("Code", ""))
                if code in ("404", "NoSuchKey", "NotFound"):
                    raise JobFailed("missing_upload", "The uploaded audio could not be found. Upload it again.", False)
                raise JobFailed("storage_error", "Could not read the upload. Retrying.", True)

            result = self.run_child(source, work, heartbeat, job)
            heartbeat.update(stage="saving", progress=1.0)
            lines = build_lines(result["segments"])
            if not lines:
                raise JobFailed("no_speech", "No speech was found in this recording.", False)
            chunks = build_chunks(lines)
            new_key = f"users/{job['user_id']}/audio/{job['document_file_id']}-{uuid.uuid4().hex[:8]}.m4a"
            compact = work / "audio.m4a"
            # Recorded before the upload, so the copy can't be lost track of: the publish
            # takes it off the cleanup list, and anything never published is swept later.
            try:
                self.db.rpc("klui_note_audio_object", {"p_job_id": job_id, "p_worker_id": self.worker_id, "p_key": new_key})
            except RuntimeError as error:
                new_key = None
                raise friendly_storage_error(str(error)) or JobFailed("publish_failed", "Could not save the transcript. Retrying.", True)
            self.r2.upload(new_key, compact, "audio/mp4")
            try:
                published = self.db.rpc("klui_complete_transcription_job", {
                    "p_job_id": job_id, "p_worker_id": self.worker_id,
                    "p_chunks": chunks, "p_segments": lines, "p_word_count": word_count(lines),
                    "p_duration_seconds": round(result["duration"], 2),
                    "p_audio_key": new_key, "p_audio_content_type": "audio/mp4",
                    "p_audio_bytes": compact.stat().st_size, "p_model": result["model"],
                })
            except RuntimeError as error:
                raise friendly_storage_error(str(error)) or JobFailed("publish_failed", "Could not save the transcript. Retrying.", True)
            stored_key, new_key = new_key, None  # Owned by the attachment now.
            old_key = (published or {}).get("old_object_key")
            if old_key and old_key != stored_key:
                # The publish put it on the cleanup list; a failed delete is retried from there.
                self.delete_objects([old_key])
            log("job done", job=job_id, audio_min=round(result["duration"] / 60, 1),
                seconds=round(time.monotonic() - started, 1), lines=len(lines),
                peak_child_mb=round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024))
        except JobFailed as failure:
            self.fail(job_id, failure)
        except Exception as error:
            log("job crashed", job=job_id, error=repr(error)[:300])
            self.fail(job_id, JobFailed("worker_error", "Transcription hit a problem. Retrying.", True))
        finally:
            heartbeat.stop()
            heartbeat.join(timeout=10)
            if new_key:
                self.discard_upload(job, new_key)
            shutil.rmtree(work, ignore_errors=True)
            self.child = None

    def discard_upload(self, job, key):
        """Delete a compact copy that never got published. If the publish call failed after
        the database committed (a lost response), the attachment already points at it, so
        it must stay. When that can't be checked, keep the file; it is on the cleanup list,
        and the sweep deletes it a day later unless an attachment references it."""
        try:
            attachment = self.db.get_attachment(job["attachment_id"])
        except Exception as error:
            log("kept unverified upload", key=key, error=str(error)[:200])
            return
        if attachment and attachment.get("object_key") == key:
            return
        self.delete_objects([key])

    def delete_objects(self, keys):
        """Delete objects on the cleanup list and take them off it. Failures stay listed."""
        done = []
        for key in keys:
            try:
                self.r2.delete(key)
                done.append(key)
            except Exception as error:
                log("object delete failed", key=key, error=str(error)[:200])
        if done:
            try:
                self.db.rpc("klui_finish_audio_object_cleanup", {"p_keys": done}, attempts=2)
            except Exception as error:
                log("cleanup list update failed", error=str(error)[:200])
        return len(done)

    def sweep_objects(self):
        """Delete due, unreferenced objects from this queue's cleanup list."""
        try:
            keys = self.db.rpc("klui_claim_audio_object_cleanup", {"p_queue": self.queue, "p_limit": 50}, attempts=2) or []
        except Exception as error:
            log("cleanup sweep failed", error=str(error)[:200])
            return
        if keys:
            log("cleanup sweep", deleted=self.delete_objects(keys), listed=len(keys))

    def run_child(self, source, work, heartbeat, job):
        duration_hint = float(job.get("duration_seconds") or 0)
        # Parakeet runs ~20x real time on 4 threads; give generous slack before calling it stuck.
        timeout = 600 + max(duration_hint, 3600) * 0.5
        child_env = {**os.environ, "OMP_NUM_THREADS": env("TRANSCRIBE_THREADS", "4")}
        # The watcher and reader hold this job's own child. Reading self.child would let a
        # watcher that outlived its job kill the next job's process.
        child = subprocess.Popen(
            [sys.executable, "-m", "transcriber.transcribe", str(source), str(work)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=child_env,
        )
        self.child = child
        error_event = {}
        stderr_tail = []
        finished = threading.Event()

        def read_stderr():
            for line in child.stderr:
                stderr_tail.append(line)
                del stderr_tail[:-20]

        def watch():
            # Soft memory ceiling below the container's hard limit, so we stop cleanly
            # instead of the kernel OOM-killing mid-write.
            while not finished.is_set() and child.poll() is None:
                if heartbeat.lost.is_set() or self.stopping:
                    child.kill()
                    return
                if rss_mb(child.pid) > self.max_child_rss:
                    error_event["memory"] = True
                    child.kill()
                    return
                if time.monotonic() - begun > timeout:
                    error_event["timeout"] = True
                    child.kill()
                    return
                self.beat()
                finished.wait(1)

        begun = time.monotonic()
        reader = threading.Thread(target=read_stderr, daemon=True)
        watcher = threading.Thread(target=watch, daemon=True)
        reader.start()
        watcher.start()
        try:
            for line in child.stdout:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                kind = event.get("event")
                if kind == "progress":
                    heartbeat.update(stage=event.get("stage"), progress=event.get("progress"))
                elif kind == "duration":
                    heartbeat.update(duration=event.get("seconds"))
                elif kind == "error":
                    error_event["input"] = event
            code = child.wait()
        finally:
            # Stop this job's watcher before the next job can start its own child.
            finished.set()
            if child.poll() is None:
                child.kill()
                child.wait()
            watcher.join()
            reader.join(timeout=5)

        if heartbeat.lost.is_set():
            raise JobFailed("cancelled", "Transcription was cancelled.", False)
        if self.stopping:
            raise JobFailed("worker_restart", "The transcriber restarted. Your recording is back in the queue.", True)
        if error_event.get("memory"):
            raise JobFailed("too_large", "This recording needed more memory than the transcriber allows.", True)
        if error_event.get("timeout"):
            raise JobFailed("timeout", "Transcription took too long. Retrying.", True)
        if code == EXIT_BAD_INPUT and "input" in error_event:
            event = error_event["input"]
            raise JobFailed(event.get("code", "bad_input"), event.get("message", "This audio could not be used."), False)
        if code != 0:
            log("child failed", code=code, stderr="".join(stderr_tail)[-500:].replace("\n", " | "))
            raise JobFailed("worker_error", "Transcription hit a problem. Retrying.", True)
        return json.loads((work / "result.json").read_text())

    def fail(self, job_id, failure):
        log("job failed", job=job_id, code=failure.code, retryable=failure.retryable)
        try:
            self.db.rpc("klui_fail_transcription_job", {
                "p_job_id": job_id, "p_worker_id": self.worker_id,
                "p_error": {"code": failure.code, "message": failure.message},
                "p_retryable": failure.retryable,
            })
        except Exception as error:
            # The lease will lapse and the job will be retried by the claim sweep.
            log("fail report failed", job=job_id, error=str(error)[:200])


def main():
    Service().run()


if __name__ == "__main__":
    main()
