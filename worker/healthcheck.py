import importlib.util
import shutil
import sys


def main():
    if importlib.util.find_spec("edgeparse") is None:
        return 1
    for binary in ("soffice", "pdftotext", "pdftoppm", "qpdf"):
        if shutil.which(binary) is None:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
