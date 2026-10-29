"""Inventory literal PMTK dataset dependencies and recover unchanged upstream files."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOAD_DATA = re.compile(r"\bloadData\s*\(\s*['\"]([^'\"]+)['\"]([^)]*)\)")
LOAD_FOLDER = re.compile(r"\bloadFolder\s*\(\s*['\"]([^'\"]+)['\"]")
LOAD_MAT_CALL = re.compile(r"\bload\s*\(\s*['\"]([A-Za-z][\w-]*)(?:\.mat)?['\"]")
LOAD_MAT_COMMAND = re.compile(r"(?m)^\s*load\s+([A-Za-z][\w-]*)(?:\.mat)?(?=\s|;|$)")
DATASET_NOTES = {
    "clown": "MATLAB built-in image, not redistributed in the official PMTK data repository; an authorized local copy is required.",
    "bolassodemoresults": "Optional experiment cache; bolassoDemo computes the experiment when this file is absent.",
    "mnistsubset": "Inactive if-0 alternative in rbmDenoiseDemo; not required by its default execution.",
    "mnist_classify": "Inactive if-0 alternative in deepBelNetClassifyDemo; not required by its default execution.",
}


def git(upstream: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(upstream), *args], text=True, encoding="utf-8"
    ).strip()


def audit(root: Path, extra_datasets: list[str] | None = None) -> dict:
    references: dict[str, set[str]] = {}
    directory_requests: set[str] = set()
    for source in sorted((root / "demos").rglob("*.m")):
        text = source.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"%\{.*?%\}", "", text, flags=re.DOTALL)
        text = re.sub(r"(?m)^\s*%.*$", "", text)
        for name, options in LOAD_DATA.findall(text):
            references.setdefault(name, set()).add(source.relative_to(root).as_posix())
            if re.search(r"['\"]ismatfile['\"]\s*,\s*false\b", options, re.IGNORECASE):
                directory_requests.add(name)
        for name in LOAD_FOLDER.findall(text):
            references.setdefault(name, set()).add(source.relative_to(root).as_posix())
            directory_requests.add(name)
        for name in LOAD_MAT_CALL.findall(text) + LOAD_MAT_COMMAND.findall(text):
            references.setdefault(name, set()).add(source.relative_to(root).as_posix())
    for name in extra_datasets or []:
        references.setdefault(name, set())
    available: dict[str, list[str]] = {}
    mat_roots = [root / "data", root / "bigData", root / "pmtksupportCopy" / "packages"]
    for runtime in (root / ".demo-runtime" / "octave").glob("octave-*-w64"):
        mat_roots.append(runtime / "mingw64" / "share" / "octave" / "packages")
    for directory in mat_roots:
        for data in sorted(directory.rglob("*.mat")):
            available.setdefault(data.stem.casefold(), []).append(
                data.relative_to(root).as_posix()
            )
    datasets = []
    for name, sources in sorted(references.items()):
        matches = available.get(name.casefold(), [])
        directories = []
        if name in directory_requests:
            for directory in ("data", "bigData"):
                directories.extend(
                    path.relative_to(root).as_posix()
                    for path in (root / directory).rglob("*")
                    if path.is_dir() and path.name.casefold() == name.casefold()
                )
        local_paths = directories if name in directory_requests else matches
        datasets.append(
            {
                "name": name,
                "references": sorted(sources),
                "mat_files": matches,
                "kind": "directory" if name in directory_requests else "mat",
                "local_paths": local_paths,
                "status": "available" if local_paths else "needs_investigation",
                "note": DATASET_NOTES.get(name.casefold(), ""),
            }
        )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Literal loadData/loadFolder and simple MAT load calls in demos, plus explicitly supplied runtime-discovered names; other dynamic names and non-MAT loads require runtime diagnosis.",
        "additional_datasets": extra_datasets or [],
        "mat_search_roots": [path.relative_to(root).as_posix() for path in mat_roots],
        "bundled_mat_files": sum(map(len, available.values())),
        "referenced_datasets": len(datasets),
        "available_datasets": sum(bool(item["local_paths"]) for item in datasets),
        "datasets": datasets,
    }


def recover(root: Path, upstream: Path, report: dict) -> list[dict]:
    commit = git(upstream, "rev-parse", "HEAD")
    tracked = git(upstream, "ls-tree", "-r", "--name-only", "HEAD").splitlines()
    folders: set[str] = set()
    for item in report["datasets"]:
        if item["local_paths"]:
            continue
        name = item["name"].casefold()
        for file in tracked:
            path = Path(file)
            if (
                item["kind"] == "directory" and file.split("/")[0].casefold() == name
            ) or (
                item["kind"] == "mat"
                and path.suffix.casefold() == ".mat"
                and path.stem.casefold() == name
            ):
                folders.add(file.split("/")[0])
    if not folders:
        return []
    subprocess.run(
        ["git", "-C", str(upstream), "sparse-checkout", "set", "--", *sorted(folders)],
        check=True,
    )
    recovered = []
    for folder in sorted(folders):
        source = upstream / folder
        destination = root / "data" / "recovered" / folder
        shutil.copytree(source, destination, dirs_exist_ok=True)
        for file in sorted(destination.rglob("*")):
            if file.is_file():
                relative = file.relative_to(root).as_posix()
                recovered.append(
                    {
                        "file": relative,
                        "source_repository": "https://github.com/probml/pmtkdata",
                        "source_commit": commit,
                        "source_path": f"{folder}/{file.relative_to(destination).as_posix()}",
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
                        "bytes": file.stat().st_size,
                    }
                )
    return recovered


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--upstream", type=Path)
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("--dataset", action="append", default=[], help="Additional runtime-discovered MAT dataset name")
    args = parser.parse_args()
    root = args.repo.resolve()
    result = audit(root, args.dataset)
    if args.recover:
        if args.upstream is None:
            parser.error("--recover requires --upstream")
        recovered = recover(root, args.upstream.resolve(), result)
        manifest_path = root / "demo-results" / "data-recovery.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        if manifest_path.exists():
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        else:
            old_audit = root / "demo-results" / "data-audit.json"
            previous = (
                json.loads(old_audit.read_text(encoding="utf-8")).get("recovered_files", [])
                if old_audit.exists()
                else []
            )
        by_file = {item["file"]: item for item in previous}
        by_file.update({item["file"]: item for item in recovered})
        manifest_path.write_text(
            json.dumps(list(by_file.values()), indent=2), encoding="utf-8"
        )
        result = audit(root, args.dataset)
        result["recovery_manifest"] = "demo-results/data-recovery.json"
    output = root / "demo-results" / "data-audit.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"{result['referenced_datasets']} literal datasets; "
        f"{result['available_datasets']} locally available; "
        f"{result['referenced_datasets'] - result['available_datasets']} requiring investigation."
    )
    for item in result["datasets"]:
        if not item["local_paths"]:
            print(f"  {item['name']}: {len(item['references'])} source references")
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
