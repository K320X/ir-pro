"""Build a deterministic manual installation archive; HACS uses the tagged source."""

from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "ir_pro"


def main():
    manifest = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    archive_path = output / "ir_pro.zip"
    files = sorted(
        path for path in COMPONENT.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
        and not path.name.endswith((".pyc", ".pyo"))
        and "Name clash" not in path.name and "sync-conflict" not in path.name
    )
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        for path in files:
            info = ZipInfo("ir_pro/" + path.relative_to(COMPONENT).as_posix())
            info.date_time = (1980, 1, 1, 0, 0, 0)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    digest = sha256(archive_path.read_bytes()).hexdigest()
    receipt = {"version": manifest["version"], "file": archive_path.name, "sha256": digest, "files": len(files)}
    (output / "package.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
