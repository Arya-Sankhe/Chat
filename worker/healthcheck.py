import shutil
import sys


def main():
    for binary in ("soffice", "pdftotext", "qpdf"):
        if shutil.which(binary) is None:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
