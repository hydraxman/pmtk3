"""Run real SVM numerical contracts in a dedicated output, never the main sweep."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnostics import diagnostic_entry
from inventory import read_json, write_json
from runner import DEFAULT_PACKAGES, OutputLock, resolve_octave, run_entry
from run_demos import validated_output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--octave", required=True)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--memory-limit-mib", type=int, default=6144)
    parser.add_argument("--graphics-toolkit", default="qt")
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = validated_output(repo, args.output or repo / "demo-results-integration")
    if output == repo / "demo-results":
        raise ValueError("SVM tests require an isolated output, not demo-results")
    entry = diagnostic_entry("svm_backend")
    entry["needs_libsvm"] = True
    with OutputLock(output):
        state = run_entry(entry, repo, output, resolve_octave(args.octave), args.timeout,
                          DEFAULT_PACKAGES, args.graphics_toolkit, memory_limit_mib=args.memory_limit_mib)
        print(f"SVM numerical contracts: {state['status']}", flush=True)
        if state["status"] != "success":
            print(json.dumps(state.get("error", {}), indent=2))
            print((output / state["log"]).read_text(encoding="utf-8", errors="replace")[-8000:])
            return 1
        artifact = (output / state["attempt_result"]).parent / "svm-backend-tests.json"
        report = {"not_original_demo": True, "attempt": state, "tests": read_json(artifact)}
        write_json(output / "svm-backend-tests.json", report)
        print(json.dumps(report["tests"], indent=2))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
