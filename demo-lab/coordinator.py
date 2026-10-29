"""Bounded subprocess scheduling; only this calling thread publishes snapshots."""
from __future__ import annotations

from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import os
from pathlib import Path
from queue import Empty, SimpleQueue
import threading
import time
import traceback
import uuid

from inventory import now, result_directory, write_json, atomic_text, read_json, within


def record_worker_error(entry: dict, output: Path, exc: BaseException) -> dict:
    """Make unexpected Python worker failures durable, never fake engine outcomes."""
    root = result_directory(output, entry)
    attempt_id = "runner-error-" + uuid.uuid4().hex[:12]
    attempt = root / "attempts" / attempt_id
    attempt.mkdir(parents=True)
    log = attempt / "runner.log"
    atomic_text(log, "".join(traceback.format_exception(exc)))
    state = {"schema_version": 1, "id": entry["id"], "source": entry["source"],
             "source_sha256": entry["sha256"], "status": "runner_error", "success": False,
             "attempt_id": attempt_id, "message": f"{type(exc).__name__}: {exc}",
             "finished_at": now(), "duration_seconds": 0, "figures": [],
             "log": log.relative_to(output).as_posix(),
             "attempt_result": (attempt / "result.json").relative_to(output).as_posix()}
    # A final filesystem/write failure must not discard an engine's original
    # exception or previously captured partial images from the active attempt.
    try:
        previous = read_json(root / "result.json")
        if previous.get("status") == "running" and previous.get("runner_pid") == os.getpid():
            old_result = output / previous["attempt_result"]
            if within(old_result, (output,)):
                old_attempt = old_result.parent
                state["previous_attempt_result"] = previous["attempt_result"]
                state["original_log"] = previous.get("log")
                state["figures"] = [
                    p.relative_to(output).as_posix() for p in sorted((old_attempt / "figures").glob("*.png"))
                    if not p.name.endswith(".part.png") and within(p, (output,)) and p.stat().st_size
                ]
                for checkpoint in ("octave-result.json", "octave-state.json"):
                    if (old_attempt / checkpoint).is_file():
                        payload = read_json(old_attempt / checkpoint)
                        if isinstance(payload.get("error"), dict):
                            state["error"] = payload["error"]
                            break
    except (OSError, ValueError, KeyError) as read_error:
        state["previous_attempt_warning"] = str(read_error)
    write_json(attempt / "result.json", state)
    write_json(root / "result.json", state)
    return state


def execute_batch(entries: list[dict], repo: Path, output: Path, octave: str, timeout: float,
                  packages: tuple[str, ...], toolkit: str, jobs: int, snapshot,
                  worker=None, progress=print, memory_limit_mib=None) -> tuple[list[dict], bool]:
    """Workers write distinct per-entry attempts; coordinator owns inventory/CSV/HTML.

    At most `jobs` futures exist, rather than queueing hundreds of uncancellable
    attempts. Ctrl+C cancels running owned process trees and schedules no more.
    """
    from runner import run_entry, DEFAULT_MEMORY_LIMIT_MIB
    worker = worker or run_entry
    if jobs not in (1, 2, 3):
        raise ValueError("--jobs must be 1, 2 or 3")
    if len({e["id"] for e in entries}) != len(entries):
        raise ValueError("Duplicate entry IDs in execution batch")
    updates = SimpleQueue()
    cancel = threading.Event()
    active = {}
    outcomes = []
    submitted = 0
    interrupted = False
    last_snapshot = 0.0
    last_progress = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=jobs, thread_name_prefix="demo-lab")

    def publish():
        nonlocal last_snapshot
        snapshot({"schema_version": 1, "updated_at": now(), "jobs": jobs,
                  "memory_limit_mib": memory_limit_mib if memory_limit_mib is not None else DEFAULT_MEMORY_LIMIT_MIB,
                  "total": len(entries), "started": submitted, "completed": len(outcomes),
                  "active": [entry["id"] for entry in active.values()],
                  "cancel_requested": cancel.is_set(),
                  "status_counts": dict(Counter(o["status"] for o in outcomes))})
        last_snapshot = time.monotonic()

    def submit():
        nonlocal submitted
        while submitted < len(entries) and len(active) < jobs and not cancel.is_set():
            entry = entries[submitted]
            submitted += 1
            progress(f"START [{submitted}/{len(entries)}] {entry['id']} (jobs={jobs})", flush=True)
            future = pool.submit(worker, entry, repo, output, octave, timeout, packages, toolkit,
                                 lambda: updates.put(True), cancel,
                                 **({"memory_limit_mib": memory_limit_mib} if memory_limit_mib is not None else {}))
            active[future] = entry

    try:
        submit()
        publish()
        while active:
            try:
                completed, _ = wait(active, timeout=.15, return_when=FIRST_COMPLETED)
                dirty = False
                while True:
                    try:
                        updates.get_nowait()
                        dirty = True
                    except Empty:
                        break
                for future in completed:
                    entry = active.pop(future)
                    try:
                        state = future.result()
                    except Exception as exc:
                        state = record_worker_error(entry, output, exc)
                    outcomes.append(state)
                    message = state.get("message") or state.get("error", {}).get("message", "")
                    progress(f"DONE [{len(outcomes)}/{len(entries)}] {entry['id']}: "
                             f"{state['status']} ({state.get('duration_seconds', 0):.3f}s) — {message}", flush=True)
                submit()
                if completed or (dirty and time.monotonic() - last_snapshot >= .25):
                    publish()
                if time.monotonic() - last_progress >= 10:
                    progress(f"PROGRESS completed={len(outcomes)}/{len(entries)} "
                             f"active={len(active)} jobs={jobs}", flush=True)
                    last_progress = time.monotonic()
            except KeyboardInterrupt:
                interrupted = True
                cancel.set()
                progress("CANCELLING: stopping owned process trees; no further demos will start.", flush=True)
        publish()
    except KeyboardInterrupt:
        interrupted = True
        cancel.set()
    finally:
        cancel.set()
        # Wait until workers have killed/reaped owned processes before the
        # caller releases OutputLock or writes a final inventory snapshot.
        while True:
            try:
                pool.shutdown(wait=True, cancel_futures=True)
                break
            except KeyboardInterrupt:
                interrupted = True
                progress("CANCELLING: waiting for owned workers to finish cleanup.", flush=True)
    if active:
        # Also finalize when Ctrl+C arrived during initial submission/snapshot,
        # rather than in the usual wait loop.
        for future, entry in active.items():
            if not future.cancelled():
                try:
                    outcomes.append(future.result())
                except Exception as exc:
                    outcomes.append(record_worker_error(entry, output, exc))
        active.clear()
        publish()
    return outcomes, interrupted
