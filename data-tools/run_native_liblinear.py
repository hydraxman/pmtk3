"""Verify genuine activated LIBLINEAR in one bounded, isolated Octave child."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "demo-lab"), str(ROOT / "data-tools")]
from diagnostics import diagnostic_entry
from inventory import read_json, write_json
from runner import DEFAULT_PACKAGES, OutputLock, resolve_octave, run_entry
from run_demos import validated_output
from build_native_providers import digest, SOURCES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--octave", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "demo-results-integration" / "native-providers")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--memory-limit-mib", type=int, default=6144)
    args = parser.parse_args()
    output = validated_output(ROOT, args.output)
    main_output = (ROOT / "demo-results").resolve()
    if output == main_output or main_output in output.parents:
        raise ValueError("Native diagnostics require isolated output, not demo-results")
    provider_folder = ROOT / "pmtksupportCopy" / "packages" / "nativeProviders" / "liblinear"
    manifest_path = provider_folder / "provider.json"
    manifest = read_json(manifest_path)
    if manifest["source"]["revision"] != SOURCES["liblinear"]["revision"] or \
            manifest.get("family") != "liblinear" or \
            manifest.get("status") not in {"built_not_loaded", "runtime_verified"}:
        raise ValueError("Active native provider is not the pinned official LIBLINEAR revision")
    for binary in manifest["binaries"]:
        native = provider_folder / Path(binary["file"]).name
        if digest(native) != binary["sha256"]:
            raise ValueError(f"Native provider checksum mismatch: {native}")
    with OutputLock(output):
        state = run_entry(
            diagnostic_entry("native_liblinear"), ROOT, output, resolve_octave(args.octave),
            args.timeout, DEFAULT_PACKAGES, "qt", memory_limit_mib=args.memory_limit_mib,
        )
        print(f"Genuine LIBLINEAR native contracts: {state['status']}", flush=True)
        if state["status"] != "success":
            print(json.dumps(state.get("error", {}), indent=2))
            print((output / state["log"]).read_text(encoding="utf-8", errors="replace")[-12000:])
            return 1
        artifact = (output / state["attempt_result"]).parent / "liblinear-tests.json"
        report = {"not_original_demo": True, "attempt": state, "tests": read_json(artifact)}
        if not report["tests"]["passed"]:
            raise ValueError("Engine did not ratify native numerical assertions")
        for binary in manifest["binaries"]:
            if digest(provider_folder / Path(binary["file"]).name) != binary["sha256"]:
                raise ValueError("Native binary changed during numerical verification")
        report_path = output / "liblinear-validation.json"
        write_json(report_path, report)
        manifest["status"] = "runtime_verified"
        manifest["runtime_execution_verified"] = True
        manifest["verification"] = {"report": str(report_path), "attempt_result": state["attempt_result"],
                                    "octave_version": report["tests"]["octave_version"]}
        write_json(manifest_path, manifest)
        print(json.dumps(report["tests"], indent=2))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
