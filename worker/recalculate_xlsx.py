"""Recalculate an XLSX with LibreOffice Calc and save evaluated formula caches."""

import subprocess
import sys
import time
from pathlib import Path

import uno


def property_value(name, value):
    prop = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    prop.Name = name
    prop.Value = value
    return prop


def main(source, output, profile):
    pipe_name = f"klui_{time.time_ns()}"
    process = subprocess.Popen([
        "soffice",
        "--headless",
        "--norestore",
        "--nofirststartwizard",
        f"-env:UserInstallation={Path(profile).resolve().as_uri()}",
        f"--accept=pipe,name={pipe_name};urp;StarOffice.ComponentContext",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    document = None
    desktop = None
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local
        )
        for _ in range(100):
            try:
                context = resolver.resolve(
                    f"uno:pipe,name={pipe_name};urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError("LibreOffice exited before recalculation started")
                time.sleep(0.1)
        else:
            raise RuntimeError("Timed out connecting to LibreOffice")

        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        document = desktop.loadComponentFromURL(
            Path(source).resolve().as_uri(),
            "_blank",
            0,
            (property_value("Hidden", True), property_value("UpdateDocMode", 3)),
        )
        if document is None:
            raise RuntimeError("LibreOffice could not open the workbook")
        document.enableAutomaticCalculation(True)
        document.calculateAll()
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        document.storeAsURL(Path(output).resolve().as_uri(), (
            property_value("FilterName", "Calc MS Excel 2007 XML"),
            property_value("Overwrite", True),
        ))
    finally:
        if document is not None:
            document.close(True)
        if desktop is not None:
            desktop.terminate()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: recalculate_xlsx.py SOURCE OUTPUT PROFILE")
    main(*sys.argv[1:])
