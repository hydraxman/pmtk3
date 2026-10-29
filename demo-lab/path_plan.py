"""Deterministic, pruned Octave path manifest (no downloads or source writes)."""
from __future__ import annotations

import os
from pathlib import Path
import re

ROOTS = ("toolbox", "matlabTools", "pmtkTools", "data", "bigData", "pmtksupportCopy")
OMIT = {"private", "deprecated", "docs", "demooutput", "demo-results", "node_modules", "cvs"}
SUPPORT_OMIT = {"test", "tests", "demo", "demos", "examples", "old"}

PMTK_SEMANTIC_ORIGINS = {
    "normalize": "matlabTools/stats/normalize.m",
    "process_options": "matlabTools/util/process_options.m",
    "gaussLogprob": "toolbox/BasicModels/gauss/gaussLogprob.m",
}


def critical_origins(repo: Path, directories: list[str]) -> list[dict]:
    contracts = []
    for name, relative in PMTK_SEMANTIC_ORIGINS.items():
        expected = repo / relative
        contracts.append({"name": name, "expected": str(expected.resolve()),
                          "promote": True, "resolution_error": "" if expected.is_file() else "Original PMTK source missing"})
    # Discover the installed official support layout, not a hardcoded runtime or
    # Lightspeed version. Do not silently choose among multiple implementations.
    candidates = sorted({str((Path(folder) / "logsumexp.m").resolve()) for folder in directories
                         if (Path(folder) / "logsumexp.m").is_file()})
    lightspeed = [p for p in candidates if any("lightspeed" in part.casefold() for part in Path(p).parts)]
    preferred = lightspeed or candidates
    expected = preferred[0] if len(preferred) == 1 else None
    contracts.append({"name": "logsumexp", "expected": expected, "promote": False,
                      "resolution_error": "" if expected else "Missing or ambiguous support logsumexp origin"})
    return contracts


def build_path_plan(repo: Path, source: Path, needs_libsvm: bool) -> dict:
    directories = [str(repo.resolve())]
    names = set()
    skipped = []
    for root_name in ROOTS:
        root = repo / root_name
        if not root.is_dir():
            continue
        support = root_name == "pmtksupportCopy"
        for parent, subdirs, files in os.walk(root, followlinks=False):
            parent = Path(parent)
            directories.append(str(parent.resolve()))
            keep = []
            for name in sorted(subdirs):
                child = parent / name
                reason = None
                if child.is_symlink() or name.startswith((".", "@", "+")) or name.casefold() in OMIT:
                    reason = "private/class/package/docs/deprecated/symlink path excluded"
                elif support and name.casefold() in SUPPORT_OMIT:
                    reason = "support examples/tests/obsolete versions excluded"
                elif support and "libsvm" in name.casefold() and not needs_libsvm:
                    reason = "legacy libsvm not requested by this source"
                if reason:
                    skipped.append({"directory": str(child.resolve()), "reason": reason})
                else:
                    keep.append(name)
            subdirs[:] = keep
            names.update(Path(name).stem for name in files
                         if name.endswith(".m") and re.fullmatch(r"[A-Za-z]\w*", Path(name).stem))
    for folder in (repo / "demos", source.parent):
        if folder.is_dir() and str(folder.resolve()) not in directories:
            directories.append(str(folder.resolve()))
    contracts = critical_origins(repo, directories)
    preferred_directories = list(dict.fromkeys(str(Path(c["expected"]).parent) for c in contracts
                                               if c["promote"] and c["expected"]))
    return {"directories": directories, "skipped": skipped, "candidate_function_names": sorted(names),
            "needs_libsvm": needs_libsvm, "preferred_directories": preferred_directories,
            "critical_origins": contracts}
