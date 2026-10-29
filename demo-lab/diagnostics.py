"""Optional real-engine probes. Never count fixture executions as original demos."""
from __future__ import annotations

import hashlib
from pathlib import Path
import sys

from analytics_fixtures import compare, reference_document
from inventory import now, read_json, write_json
from runner import run_entry, DEFAULT_MEMORY_LIMIT_MIB


def diagnostic_entry(name: str) -> dict:
    source = Path(__file__).parent / "octave" / f"demo_lab_{name}.m"
    return {"id": f"diagnostics/{name}", "name": source.stem, "source": str(source.resolve()),
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "entry_type": "function",
            "runnable": True, "safety": [], "needs_libsvm": False}


def run_diagnostic(action: str, repo: Path, output: Path, octave: str | None,
                   timeout: float, packages: tuple[str, ...], toolkit: str,
                   memory_limit_mib=DEFAULT_MEMORY_LIMIT_MIB) -> int:
    destination = output / ("analytics-fixtures.json" if action == "fixtures" else "probe.json")
    document = reference_document() if action == "fixtures" else {
        "schema_version": 1, "kind": "environment probe", "not_original_demo": True}
    document["generated_at"] = now()
    document["python"] = {"version": sys.version, "executable": sys.executable}
    if octave is None:
        write_json(destination, document)
        print(f"Reference only; no Octave results claimed: {destination}", flush=True)
        return 0
    entry = diagnostic_entry(action)
    if action == "fixtures":
        entry["fixture_inputs"] = {name: f["inputs"] for name, f in document["fixtures"].items()}
    print(f"Starting bounded Octave {action}; not an original-demo batch.", flush=True)
    state = run_entry(entry, repo, output, octave, timeout, packages, toolkit,
                      memory_limit_mib=memory_limit_mib)
    document["attempt"] = state
    document["status"] = state["status"]
    document["success"] = False
    attempt = (output / state["attempt_result"]).parent
    artifact = attempt / ("analytics-output.json" if action == "fixtures" else "probe-output.json")
    failures = []
    if artifact.is_file():
        try:
            actual = read_json(artifact)
            if action == "fixtures":
                expected = {name: f["reference"] for name, f in document["fixtures"].items()}
                failures = compare(expected, actual)
                for name, value in actual.items():
                    if name in document["fixtures"]:
                        document["fixtures"][name]["octave"] = value
            else:
                document["environment"] = actual
        except (OSError, ValueError) as exc:
            failures.append(f"Cannot read engine artifact: {exc}")
    else:
        failures.append("Engine did not produce its diagnostic artifact")
    document["failed_assertions"] = failures
    if state["status"] == "success":
        document["status"] = "passed" if not failures else "failed"
        document["success"] = not failures
    write_json(destination, document)
    print(f"{action}: {document['status']} — {destination}", flush=True)
    for failure in failures:
        print(f"  {failure}", flush=True)
    return 0 if document["success"] else 1
