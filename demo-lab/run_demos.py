#!/usr/bin/env python3
"""PMTK3 original demo lab: standard-library-only inventory, Octave runner, gallery.

Examples (run from repository root):
  python demo-lab/run_demos.py inventory
  python demo-lab/run_demos.py gallery
  python demo-lab/run_demos.py run --octave <octave.exe> --timeout 45 --limit 3
  python demo-lab/run_demos.py run --octave <octave.exe> --timeout 45 --jobs 3
  python demo-lab/run_demos.py run --octave <octave.exe> --demo gaussPlotDemo
  python demo-lab/run_demos.py run --octave <octave.exe> --retry-failed
  python demo-lab/run_demos.py run --octave <octave.exe> --retry-status timeout
  python demo-lab/run_demos.py probe --octave <octave.exe> --timeout 30
  python demo-lab/run_demos.py fixtures
  python demo-lab/run_demos.py fixtures --octave <octave.exe> --timeout 30

Completed outcomes are not re-run by default, including failures. --retry-failed
retries failed, timeout, runner_error, interrupted. --retry-status success
explicitly repeats successes. Changed source hashes automatically become stale.
Use --demo repeatedly; --limit counts attempts, not skipped helpers. An explicit
non-runnable/blocked selection is reported and exits 1. No unsafe override exists.
Early MATLAB-only Octave return guards are unsupported/not executed, never
successful nonvisual demos; even explicit retry flags cannot execute them.
All subcommands accept --repo and --output AFTER the subcommand. Octave is supplied
by the caller: nothing is installed/downloaded. Each attempt keeps its own cwd,
log, PNGs, runtime/package metadata, and result. Gallery is built BEFORE running,
then refreshed after each attempt. Ctrl+C saves interrupted state. Resume by
repeating the command. Previous attempts remain on disk.
--jobs 1/2/3 bounds process concurrency (default 1). Numerical engine threads
are bounded to one per child. One coordinator publishes progress.json and
inventory/CSV/gallery snapshots; workers write only their separate attempts.
Windows defaults to --memory-limit-mib 6144: hard per-process AND owned-tree
committed-memory caps, plus sampled Octave working/private-byte checks. Memory
hits terminate the owned tree and record resource_limit, never success.

Path order: packages load first; trusted PMTK stats/util/gauss semantic-contract
directories then take priority (especially whole-array normalize). Other PMTK
and support paths are appended; lab/builtin guards remain first. Four critical
origins and numerical semantics are checked before source invocation, recorded
in path-origins.json. No docs/demoOutput paths are added.
Root-level functions needing inputs and nested helpers are not run. Optional-input
demos require a visible zero-input guard. Static safety classification is not a
security sandbox or a complete transitive analysis. Run trusted original code only.
Captures use figure DeleteFcn before close plus remaining figures at completion;
callbacks reset by demos, hard exits, timeouts, clear-figure content, or explicit
delete overriding callbacks can lose figures. Export failures are logged in JSON,
never represented as generated PNGs. Nonvisual successes are valid.
"""
from __future__ import annotations

import argparse
from collections import Counter
import math
from pathlib import Path
import sys

# Windows embeddable Python's ._pth isolation omits the script directory.
# Bootstrap only this owned directory; never require global/site installation.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gallery import build_gallery
from coordinator import execute_batch
from inventory import (RETRY_STATUSES, TERMINAL_STATUSES, build_inventory, current_result,
                       save_inventory, within, write_json, default_status)
from runner import (DEFAULT_PACKAGES, OutputLock, resolve_octave, run_entry, select_entries,
                    resolve_selections, selector_matches)
from memory_guard import DEFAULT_MEMORY_LIMIT_MIB, memory_limit_bytes


def refresh(inventory: dict, repo: Path, output: Path) -> Path:
    from inventory import now
    inventory["generated_at"] = now()
    for entry in inventory["entries"]:
        entry["result"] = current_result(entry, output)
    save_inventory(inventory, output)
    return build_gallery(inventory, repo, output)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = result.add_subparsers(dest="action", required=True)
    for action in ("inventory", "gallery", "run", "probe", "fixtures"):
        command = sub.add_parser(action)
        command.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
        command.add_argument("--output", type=Path, default=None, help="Default: <repo>/demo-results")
        if action in ("run", "probe", "fixtures"):
            command.add_argument("--octave", required=action != "fixtures", help="Caller-provisioned Octave executable")
            command.add_argument("--timeout", type=float, default=45)
            command.add_argument("--memory-limit-mib", type=int, default=DEFAULT_MEMORY_LIMIT_MIB,
                                 help="Windows owned-tree commit and Octave working/private memory cap; default 6144 MiB")
            command.add_argument("--package", action="append", default=None,
                                 help="Repeat to replace default available-package load list")
            command.add_argument("--graphics-toolkit", default="qt", help="Preferred toolkit, fallback recorded")
        if action == "run":
            command.add_argument("--demo", action="append", default=[], help="Repeatable exact stem, ID or source")
            command.add_argument("--retry-failed", action="store_true")
            command.add_argument("--retry-status", action="append", default=[],
                                 choices=sorted(TERMINAL_STATUSES | {"stale"}))
            command.add_argument("--limit", type=int)
            command.add_argument("--jobs", type=int, choices=(1, 2, 3), default=1)
    return result


def validated_output(repo: Path, value: Path | None) -> Path:
    output = (value if value is not None else repo / "demo-results").expanduser().resolve()
    # Output must never overwrite source/runtime/support directories.
    forbidden = [repo / name for name in ("demos", "toolbox", "matlabTools", "pmtkTools", "data",
                                         "bigData", "docs", "figures", "pmtksupportCopy",
                                         ".demo-runtime", ".git", "demo-lab")]
    if output == repo or repo.is_relative_to(output) or within(output, tuple(forbidden)):
        raise ValueError("Output must be a dedicated results directory, not source/runtime/support or its parent")
    return output


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        repo = args.repo.expanduser().resolve()
        if not (repo / "demos").is_dir():
            raise ValueError(f"No demos directory: {repo}")
        output = validated_output(repo, args.output)
        if args.action in ("run", "probe", "fixtures"):
            if not math.isfinite(args.timeout) or args.timeout <= 0:
                raise ValueError("--timeout must be finite and positive")
            memory_limit_bytes(args.memory_limit_mib)
            if args.action == "run" and args.limit is not None and args.limit < 0:
                raise ValueError("--limit must be zero or positive")
            octave = resolve_octave(args.octave) if args.octave else None
        # A lock also protects inventory/gallery from overwriting an active run's
        # incremental snapshot. Each read is rebuilt from per-entry durable results.
        with OutputLock(output):
            if args.action in ("probe", "fixtures"):
                from diagnostics import run_diagnostic
                return run_diagnostic(args.action, repo, output, octave, args.timeout,
                                      tuple(args.package) if args.package is not None else DEFAULT_PACKAGES,
                                      args.graphics_toolkit, args.memory_limit_mib)
            inventory = build_inventory(repo, output)
            gallery = refresh(inventory, repo, output)
            print(f"Gallery: {gallery}", flush=True)
            print("Counts:", inventory["counts"], flush=True)
            if args.action != "run":
                print("Statuses:", dict(Counter(e["result"]["status"] for e in inventory["entries"])))
                return 0
            selected = select_entries(inventory["entries"], args.demo, args.retry_failed,
                                      args.retry_status, args.limit)
            refused = [e for e in resolve_selections(inventory["entries"], args.demo)
                       if default_status(e) != "pending"]
            for entry in refused:
                print(f"REFUSED {entry['id']}: {entry['result']['status']} -- "
                      f"{entry['result'].get('message', '')}", flush=True)
            print(f"Attempting {len(selected)} entries; completed outcomes otherwise retained.", flush=True)
            failed = bool(refused)
            def snapshot(batch):
                write_json(output / "progress.json", batch)
                refresh(inventory, repo, output)
            try:
                outcomes, interrupted = execute_batch(
                    selected, repo, output, octave, args.timeout,
                    tuple(args.package) if args.package is not None else DEFAULT_PACKAGES,
                    args.graphics_toolkit, args.jobs, snapshot, worker=run_entry,
                    memory_limit_mib=args.memory_limit_mib)
            except KeyboardInterrupt:
                refresh(inventory, repo, output)
                print("Interrupted; owned workers cleaned up and state saved.", file=sys.stderr)
                return 130
            failed |= any(o["status"] != "success" for o in outcomes)
            if interrupted:
                print("Interrupted; state saved. Repeat the command to resume.", file=sys.stderr)
                return 130
            print("Statuses:", dict(Counter(e["result"]["status"] for e in inventory["entries"])))
            print(f"Gallery: {gallery}")
            # A resumed batch with retained failures must not silently exit 0.
            failed |= any(e["runnable"] and not e["safety"]
                          and e["result"]["status"] in RETRY_STATUSES
                          and (not args.demo or any(selector_matches(e, s) for s in args.demo))
                          for e in inventory["entries"])
            return 1 if failed else 0
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"demo-lab: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
