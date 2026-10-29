"""Recover narrowly scoped PMTK FA dependencies from their original MIT-licensed history."""

import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REVISION = "3ed78c13d08393604325fcb38c58551a485337e3"
FILES = (
    "FA/gaussFA/initFA.m",
    "FA/gaussFA/inferFA.m",
    "FA/gaussFA/inferFA_miss.m",
    "FA/gaussFA/maxParamsFA.m",
    "FA/MixedDataFA/initMixedDataFA.m",
    "FA/MixedDataFA/inferMixedDataFA.m",
    "FA/MixedDataFA/inferMixedDataFA_miss.m",
    "FA/MixedDataFA/inferMixedDataFA_jaakkola.m",
    "FA/MixedDataFA/maxParamsMixedDataFA.m",
    "FA/MixedDataFA/imputeMissingMixedDataFA.m",
    "FA/MixedDataFA/imputeMissingMixedDataFA_ver1.m",
    "encodeDataOneOfM.m",
    "isConverged.m",
    "learnEm.m",
    "myLogSoftMax.m",
)


def main() -> None:
    paths = [f"projects/Emt/{file}" for file in FILES]
    archive = subprocess.check_output(
        ["git", "-C", str(ROOT), "archive", "--format=zip", REVISION, "--", *paths]
    )
    destination = ROOT / "pmtksupportCopy" / "packages" / "legacyEmt"
    manifest = []
    recovered = []
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for path in paths:
            data = source.read(path)
            output = destination / Path(path).name
            if output.exists() and output.read_bytes() != data:
                raise RuntimeError(f"Refusing to overwrite modified recovered source: {output}")
            recovered.append((output, data))
            manifest.append(
                {
                    "file": output.relative_to(ROOT).as_posix(),
                    "source_repository": "https://github.com/probml/pmtk3",
                    "source_commit": REVISION,
                    "source_path": path,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
    license_data = (ROOT / "license.txt").read_bytes()
    destination.mkdir(parents=True, exist_ok=True)
    for output, data in recovered:
        if not output.exists():
            output.write_bytes(data)
    (destination / "PMTK-license.txt").write_bytes(license_data)
    output = ROOT / "demo-results" / "legacy-support-recovery.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Recovered {len(manifest)} original FA dependencies; provenance: {output}")


if __name__ == "__main__":
    main()
