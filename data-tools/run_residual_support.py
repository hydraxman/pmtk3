"""Run real projection/UGM contracts safely, without touching the main sweep."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo-lab"))
from diagnostics import diagnostic_entry
from inventory import read_json, write_json
from runner import DEFAULT_PACKAGES, OutputLock, resolve_octave, run_entry
from run_demos import validated_output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--octave", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "demo-results-integration" / "residual-repair")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--memory-limit-mib", type=int, default=6144)
    parser.add_argument("--graphics-toolkit", default="qt")
    args = parser.parse_args()
    output = validated_output(ROOT, args.output)
    if output == ROOT / "demo-results":
        raise ValueError("Residual tests require an isolated output, not demo-results")
    with OutputLock(output):
        state = run_entry(
            diagnostic_entry("residual_support"), ROOT, output, resolve_octave(args.octave),
            args.timeout, DEFAULT_PACKAGES, args.graphics_toolkit,
            memory_limit_mib=args.memory_limit_mib,
        )
        print(f"Residual support numerical contracts: {state['status']}", flush=True)
        if state["status"] != "success":
            print(json.dumps(state.get("error", {}), indent=2))
            print((output / state["log"]).read_text(encoding="utf-8", errors="replace")[-8000:])
            return 1
        artifact = (output / state["attempt_result"]).parent / "residual-support-tests.json"
        report = {"not_original_demo": True, "attempt": state, "tests": read_json(artifact)}
        write_json(output / "residual-support-tests.json", report)
        print(json.dumps(report["tests"], indent=2))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
