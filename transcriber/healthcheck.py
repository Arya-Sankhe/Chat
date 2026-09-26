import os
import shutil
import sys
import time
from pathlib import Path


def main():
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            return 1
    model_dir = Path(os.environ.get("TRANSCRIBE_MODEL_DIR", "/models"))
    if not (model_dir / "parakeet" / "encoder.int8.onnx").exists():
        return 1
    # The service touches this file every loop; a stale one means it is wedged.
    beat = Path(os.environ.get("TRANSCRIBE_WORK_DIR", "/work")) / ".alive"
    try:
        return 0 if time.time() - beat.stat().st_mtime < 180 else 1
    except OSError:
        return 1


if __name__ == "__main__":
    sys.exit(main())
