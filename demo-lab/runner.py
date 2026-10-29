"""Isolated subprocess execution and strict result protocol."""
from __future__ import annotations

import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time
import uuid

from inventory import (RETRY_STATUSES, default_status, now, read_json,
                       result_directory, within, write_json)
from path_plan import build_path_plan
from memory_guard import DEFAULT_MEMORY_LIMIT_MIB, MEMORY_POLL_SECONDS, MemoryMonitor, memory_limit_bytes

DEFAULT_PACKAGES = ("statistics", "optim", "signal", "image", "io", "control", "struct",
                    "symbolic", "splines")


def octave_literal(value: str) -> str:
    return "'" + value.replace("\\", "/").replace("'", "''") + "'"


def command_for(octave: str, harness: Path) -> list[str]:
    # The GUI-linked binary retains the Qt graphics backend under --no-gui.
    # Never substitute engines implicitly or start the interactive desktop UI.
    expr = f"addpath({octave_literal(str(harness.resolve()))}, '-begin'); demo_lab_main();"
    frontend = ["--no-gui"] if Path(octave.replace("\\", "/")).stem.casefold() == "octave-gui" else []
    return [octave, *frontend, "--no-init-file", "--no-site-file", "--no-history", "--quiet", "--eval", expr]


def runtime_environment(octave: str, inherited: dict[str, str]) -> tuple[dict[str, str], dict]:
    """Configure only this child; GUI Qt libraries/plugins must match its bundle."""
    environment = inherited.copy()
    environment["OMP_THREAD_LIMIT"] = "1"
    binary = Path(octave).resolve()
    gui = binary.stem.casefold() == "octave-gui"
    paths = [binary.parent] if binary.is_file() else []
    profile = {"executable": str(binary), "binary_kind": "gui" if gui else "console",
               "frontend": "--no-gui" if gui else "console",
               "qt_bundle": None, "qt_environment": {}}
    if gui and os.name == "nt":
        bundles = sorted(folder for folder in binary.parent.parent.glob("qt*")
                         if (folder / "bin").is_dir() and (folder / "plugins").is_dir())
        if len(bundles) != 1:
            raise ValueError("GUI Octave requires one discoverable bundled Qt bin/plugins pair; "
                             "refusing to guess a missing or ambiguous Qt installation")
        qt = bundles[0]
        paths.append(qt / "bin")
        qt_environment = {"QT_PLUGIN_PATH": str(qt / "plugins"),
                          "QT_QPA_PLATFORM": "windows", "QT_OPENGL": "software"}
        if (qt / "plugins" / "platforms").is_dir():
            qt_environment["QT_QPA_PLATFORM_PLUGIN_PATH"] = str(qt / "plugins" / "platforms")
        environment.update(qt_environment)
        profile.update(qt_bundle=str(qt), qt_environment=qt_environment)
    # Official Windows archives keep makeinfo's Perl in sibling usr/bin.
    bundled_usr = binary.parent.parent.parent / "usr" / "bin"
    if os.name == "nt" and (bundled_usr / "perl.exe").is_file():
        paths.append(bundled_usr)
    if os.name == "nt" and environment.get("DEMO_LAB_REPO"):
        repo = Path(environment["DEMO_LAB_REPO"]).resolve()
        graphviz_root = (repo / ".demo-runtime" / "graphviz").resolve()
        manifest = graphviz_root / "runtime.json"
        if manifest.is_file():
            if not graphviz_root.is_relative_to(repo):
                raise ValueError("Graphviz runtime must remain inside this repository")
            config = json.loads(manifest.read_text(encoding="utf-8-sig"))
            dot = (graphviz_root / config["dot_relative"]).resolve()
            plugins = (graphviz_root / config["plugin_directory_relative"]).resolve()
            if not dot.is_relative_to(graphviz_root) or not plugins.is_relative_to(graphviz_root):
                raise ValueError("Graphviz runtime paths escape their configured runtime")
            if not dot.is_file() or not plugins.is_dir():
                raise ValueError("Configured Graphviz runtime is incomplete")
            digest = hashlib.sha256(dot.read_bytes()).hexdigest()
            if digest != config["dot_sha256"].lower():
                raise ValueError("Configured Graphviz executable does not match its verified manifest")
            paths.append(dot.parent)
            environment["GVBINDIR"] = str(plugins)
            profile["graphviz"] = {"version": config["version"], "executable": str(dot),
                                   "sha256": digest, "manifest": str(manifest)}
    if paths:
        environment["PATH"] = os.pathsep.join([*(str(p) for p in paths), environment.get("PATH", "")])
    profile["path_directories"] = [str(p) for p in paths]
    return environment, profile


def resolve_octave(value: str) -> str:
    resolved = shutil.which(value)
    if resolved:
        return str(Path(resolved).resolve())
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"Octave executable not found: {value}")
    return str(path)


def select_entries(entries: list[dict], demos: list[str], retry_failed: bool,
                   retry_status: list[str], limit: int | None) -> list[dict]:
    selected_ids = {e["id"] for e in resolve_selections(entries, demos)}
    statuses = {"pending", "stale", "running", "interrupted"} | set(retry_status)
    if retry_failed:
        statuses |= RETRY_STATUSES
    result = []
    for entry in entries:
        if selected_ids and entry["id"] not in selected_ids:
            continue
        if default_status(entry) != "pending":
            continue
        if entry["result"]["status"] in statuses:
            result.append(entry)
    return result[:limit] if limit is not None else result


def selector_matches(entry: dict, selector: str) -> bool:
    value = selector.replace("\\", "/").casefold()
    options = [entry["id"], entry["name"], entry.get("source"), entry["id"] + ".m"]
    for alias in entry.get("historical_aliases", []):
        options.extend([alias["published_stem"], alias["published_stem"] + ".m", alias["old_source"]])
    if entry.get("source"):
        options.append(Path(entry["source"]).name)
    return value in {s.casefold() for s in options if s is not None}


def resolve_selections(entries: list[dict], demos: list[str]) -> list[dict]:
    selected = {}
    for selector in demos:
        matches = [e for e in entries if selector_matches(e, selector)]
        if not matches:
            raise ValueError(f"Unknown demo: {selector}")
        if len(matches) > 1:
            raise ValueError(f"Ambiguous demo {selector!r}; use an exact ID or source path")
        selected[matches[0]["id"]] = matches[0]
    return list(selected.values())


def pid_alive(pid: int) -> bool:
    if os.name == "nt":
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() == 5  # access denied: conservatively alive
        try:
            status = wintypes.DWORD()
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(status)) or status.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class OutputLock:
    """Prevent two runners writing the same output; safely reclaim dead locks."""
    def __init__(self, output: Path):
        self.path = output / ".runner.lock"

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                try:
                    old = read_json(self.path)
                    pid = int(old["pid"])
                except (ValueError, KeyError, OSError):
                    raise RuntimeError(f"Unreadable lock; inspect manually: {self.path}") from None
                if pid_alive(pid):
                    raise RuntimeError(f"Runner PID {pid} holds {self.path}")
                self.path.unlink()
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                import json
                json.dump({"pid": os.getpid(), "started_at": now()}, stream)
            return self
        raise RuntimeError(f"Cannot acquire lock: {self.path}")

    def __exit__(self, *_):
        self.path.unlink(missing_ok=True)


class WindowsJob:
    """Kill-on-close Job Object: includes child processes even if Octave exits.

    If job assignment is unavailable, fail the attempt rather than silently
    losing the guarantee that owned child processes will be terminated.
    """
    def __init__(self, process: subprocess.Popen, memory_limit_bytes: int | None = None):
        from ctypes import wintypes as w

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                        ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", w.DWORD),
                        ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD),
                        ("SchedulingClass", w.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in
                        ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                         "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        kernel.CreateJobObjectW.restype = w.HANDLE
        kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        kernel.OpenProcess.restype = w.HANDLE
        kernel.CloseHandle.argtypes = [w.HANDLE]
        self.kernel = kernel
        self.port = None
        self.memory_event = None
        self.handle = kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            info = Extended()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if memory_limit_bytes is not None:
                # Bound aggregate committed memory for the entire owned tree,
                # not just the Octave leader. Allocation spikes cannot bypass
                # the cap between RSS samples. Notifications override even an
                # engine exit-zero result after a caught allocation failure.
                info.BasicLimitInformation.LimitFlags |= 0x100 | 0x200
                info.ProcessMemoryLimit = memory_limit_bytes
                info.JobMemoryLimit = memory_limit_bytes
                kernel.CreateIoCompletionPort.argtypes = [w.HANDLE, w.HANDLE, ctypes.c_size_t, w.DWORD]
                kernel.CreateIoCompletionPort.restype = w.HANDLE
                self.port = kernel.CreateIoCompletionPort(ctypes.c_void_p(-1), None, 0, 1)
                if not self.port:
                    raise ctypes.WinError(ctypes.get_last_error())

                class Association(ctypes.Structure):
                    _fields_ = [("CompletionKey", ctypes.c_void_p), ("CompletionPort", w.HANDLE)]

                association = Association(1, self.port)
                if not kernel.SetInformationJobObject(self.handle, 7, ctypes.byref(association),
                                                      ctypes.sizeof(association)):
                    raise ctypes.WinError(ctypes.get_last_error())
                kernel.GetQueuedCompletionStatus.argtypes = [
                    w.HANDLE, ctypes.POINTER(w.DWORD), ctypes.POINTER(ctypes.c_size_t),
                    ctypes.POINTER(ctypes.c_void_p), w.DWORD]
                kernel.GetQueuedCompletionStatus.restype = w.BOOL
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
                raise ctypes.WinError(ctypes.get_last_error())
            handle = kernel.OpenProcess(0x0101, False, process.pid)  # SET_QUOTA | TERMINATE
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if not kernel.AssignProcessToJobObject(self.handle, handle):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                kernel.CloseHandle(handle)
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
        if self.port:
            self.kernel.CloseHandle(self.port)
            self.port = None

    def memory_violation(self) -> dict | None:
        """Drain this private job's queue; no host-wide process enumeration."""
        from ctypes import wintypes as w
        while self.port:
            message, key, pid = w.DWORD(), ctypes.c_size_t(), ctypes.c_void_p()
            if not self.kernel.GetQueuedCompletionStatus(
                    self.port, ctypes.byref(message), ctypes.byref(key), ctypes.byref(pid), 0):
                error = ctypes.get_last_error()
                if error == 258:  # WAIT_TIMEOUT: empty queue, not a monitoring failure
                    break
                raise ctypes.WinError(error)
            if message.value in (9, 10):  # PROCESS_MEMORY_LIMIT / JOB_MEMORY_LIMIT
                self.memory_event = {"kind": "process_commit" if message.value == 9 else "job_commit",
                                     "notification": message.value, "pid": pid.value}
        return self.memory_event

    def resume(self, process: subprocess.Popen):
        """Resume the primary thread after job assignment, closing the spawn race."""
        from ctypes import wintypes as w

        class ThreadEntry(ctypes.Structure):
            _fields_ = [("dwSize", w.DWORD), ("cntUsage", w.DWORD),
                        ("th32ThreadID", w.DWORD), ("th32OwnerProcessID", w.DWORD),
                        ("tpBasePri", w.LONG), ("tpDeltaPri", w.LONG), ("dwFlags", w.DWORD)]

        kernel = self.kernel
        kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
        kernel.Thread32First.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        kernel.Thread32Next.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        kernel.OpenThread.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        kernel.OpenThread.restype = w.HANDLE
        kernel.ResumeThread.argtypes = [w.HANDLE]
        kernel.ResumeThread.restype = w.DWORD
        snapshot = kernel.CreateToolhelp32Snapshot(0x00000004, 0)  # TH32CS_SNAPTHREAD
        if snapshot == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            item = ThreadEntry()
            item.dwSize = ctypes.sizeof(item)
            found = kernel.Thread32First(snapshot, ctypes.byref(item))
            while found:
                if item.th32OwnerProcessID == process.pid:
                    thread = kernel.OpenThread(0x0002, False, item.th32ThreadID)  # SUSPEND_RESUME
                    if not thread:
                        raise ctypes.WinError(ctypes.get_last_error())
                    try:
                        if kernel.ResumeThread(thread) == 0xFFFFFFFF:
                            raise ctypes.WinError(ctypes.get_last_error())
                        return
                    finally:
                        kernel.CloseHandle(thread)
                item.dwSize = ctypes.sizeof(item)
                found = kernel.Thread32Next(snapshot, ctypes.byref(item))
            raise RuntimeError(f"No primary thread for suspended owned PID {process.pid}")
        finally:
            kernel.CloseHandle(snapshot)


def kill_owned(process: subprocess.Popen, job: WindowsJob | None) -> None:
    if os.name == "nt":
        if job:
            job.close()
        else:
            # Only the PID of the process we just spawned; never kill by image name.
            subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Unable to reap owned process PID {process.pid}") from exc


def validate_harness(path: Path, returncode: int, source: str) -> tuple[str, dict]:
    try:
        payload = read_json(path)
    except (OSError, ValueError) as exc:
        return "runner_error", {"message": f"Missing/invalid Octave result (exit {returncode}): {exc}"}
    if (type(payload.get("success")) is not bool or payload.get("completed") is not True
            or payload.get("source") != source):
        return "runner_error", {"message": "Octave result protocol/identity mismatch"}
    unsupported = payload.get("status") == "unsupported"
    if unsupported and (payload["success"] or payload.get("workload_executed") is not False
                        or not isinstance(payload.get("requirement"), str) or not payload["requirement"].strip()):
        return "runner_error", {"message": "Unsupported engine result cannot claim workload success"}
    expected = 3 if unsupported else 0 if payload["success"] else 1
    if returncode != expected:
        return "runner_error", {"message": f"Octave success={payload['success']} disagrees with exit {returncode}",
                                "octave_result": payload}
    if not payload["success"] and not isinstance(payload.get("error"), dict):
        return "runner_error", {"message": "Octave failure lacks serialized error"}
    return ("unsupported" if unsupported else "success" if payload["success"] else "failed"), payload


def relative(path: Path, output: Path) -> str:
    if not within(path, (output,)):
        raise ValueError(f"Artifact escaped output: {path}")
    return path.resolve().relative_to(output.resolve()).as_posix()


def run_entry(entry: dict, repo: Path, output: Path, octave: str, timeout: float,
              packages: tuple[str, ...] = DEFAULT_PACKAGES, toolkit: str = "qt",
              on_update=None, cancel_event: threading.Event | None = None,
              memory_limit_mib: int | None = DEFAULT_MEMORY_LIMIT_MIB) -> dict:
    if default_status(entry) != "pending":
        raise ValueError(f"Refusing non-runnable/unsafe/unsupported entry: {entry['id']}")
    if timeout <= 0 or not math.isfinite(timeout):
        raise ValueError("Timeout must be finite and positive")
    limit_bytes = memory_limit_bytes(memory_limit_mib)
    root = result_directory(output, entry)
    attempt_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:12]
    attempt = root / "attempts" / attempt_id
    work = attempt / "work"
    work.mkdir(parents=True)
    (work / "figures").mkdir()
    (attempt / "figures").mkdir()
    log_path = attempt / "octave.log"
    harness_path = attempt / "octave-result.json"
    metadata_path = attempt / "runtime.json"
    command = command_for(octave, Path(__file__).parent / "octave")
    environment = os.environ.copy()
    environment.update(
        DEMO_LAB_REPO=str(repo.resolve()), DEMO_LAB_SOURCE=str((repo / entry["source"]).resolve()),
        DEMO_LAB_ATTEMPT=str(attempt.resolve()), DEMO_LAB_SOURCE_ID=entry["source"],
        DEMO_LAB_ENTRY=entry["name"], DEMO_LAB_ENTRY_TYPE=entry["entry_type"],
        DEMO_LAB_PACKAGES=",".join(packages), DEMO_LAB_TOOLKIT=toolkit,
        DEMO_LAB_OCTAVE=str(Path(octave).resolve()),
        GNUTERM="pngcairo",
        TMP=str((attempt / "tmp").resolve()), TEMP=str((attempt / "tmp").resolve()),
        TMPDIR=str((attempt / "tmp").resolve()),
        OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1", BLIS_NUM_THREADS="1",
        DEMO_LAB_NEEDS_LIBSVM="1" if entry.get("needs_libsvm", False) else "0",
    )
    environment, runtime_profile = runtime_environment(octave, environment)
    (attempt / "tmp").mkdir()
    result = {"schema_version": 1, "id": entry["id"], "source": entry["source"],
              "source_sha256": entry["sha256"], "status": "running", "success": False,
              "started_at": now(), "attempt_id": attempt_id, "timeout_seconds": timeout,
              "runner_pid": os.getpid(),
              "numerical_threads": 1,
              "memory_limit_mib": memory_limit_mib,
              "runtime_path_directories": runtime_profile["path_directories"],
              "runtime_profile": runtime_profile,
              "command": command, "log": relative(log_path, output),
              "attempt_result": relative(attempt / "result.json", output), "figures": [],
              "harness_result": relative(harness_path, output),
              "path_origins": relative(attempt / "path-origins.json", output),
              "metadata": relative(metadata_path, output)}
    write_json(attempt / "request.json", {**result, "packages_requested": packages,
                                         "graphics_toolkit_requested": toolkit})
    write_json(attempt / "path-plan.json",
               build_path_plan(repo, repo / entry["source"], entry.get("needs_libsvm", False)))
    if entry.get("fixture_inputs") is not None:
        write_json(attempt / "fixture-inputs.json", entry["fixture_inputs"])
    write_json(root / "result.json", result)
    write_json(attempt / "result.json", result)
    if on_update:
        on_update()
    start = time.monotonic()
    process = None
    job = None
    monitor = None
    interrupted = False

    def stop_for_memory_limit() -> bool:
        if monitor is None:
            return False
        violation = job.memory_violation()
        if process.poll() is None:
            try:
                sample = monitor.sample()
            except OSError:
                if process.poll() is None:
                    raise  # fail closed if an active owned process cannot be measured
            else:
                for metric in ("working_set_bytes", "private_bytes"):
                    if sample[metric] >= limit_bytes:
                        violation = {"kind": metric, "observed_bytes": sample[metric], "pid": process.pid}
                        break
        if violation is None:
            return False
        monitor.violation = violation
        kill_owned(process, job)
        result.update(status="resource_limit", success=False, returncode=process.returncode,
                      message=f"Memory limit {memory_limit_mib} MiB reached ({violation['kind']}); "
                              "owned process tree terminated.")
        return True

    try:
        with log_path.open("wb") as log:
            process = subprocess.Popen(command, cwd=work, env=environment, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=os.name != "nt",
                                       creationflags=0x00000004 if os.name == "nt" else 0)  # CREATE_SUSPENDED
            result["pid"] = process.pid
            if os.name == "nt":
                job = WindowsJob(process, limit_bytes)
                if limit_bytes is not None:
                    monitor = MemoryMonitor(process, limit_bytes)
                    monitor.sample()  # validate measurement while the engine is still suspended
                job.resume(process)
            write_json(root / "result.json", result)
            deadline = start + timeout
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    kill_owned(process, job)
                    result.update(status="interrupted", message="Batch cancelled; owned process tree terminated.",
                                  returncode=process.returncode)
                    break
                if stop_for_memory_limit():
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    kill_owned(process, job)
                    result.update(status="timeout", message=f"Exceeded {timeout:g}s; owned process tree terminated.",
                                  returncode=process.returncode)
                    break
                try:
                    returncode = process.wait(timeout=min(MEMORY_POLL_SECONDS, remaining))
                except subprocess.TimeoutExpired:
                    continue
                if stop_for_memory_limit():
                    break
                status, payload = validate_harness(harness_path, returncode, entry["source"])
                result.update(status=status, returncode=returncode, **{
                    key: payload[key] for key in ("error", "message", "octave_result", "capture_errors",
                                                 "requirement", "workload_executed", "execution_disposition")
                    if key in payload
                })
                result["success"] = status == "success"
                break
    except KeyboardInterrupt:
        interrupted = True
        result.update(status="interrupted", message="Runner interrupted; owned process tree terminated.")
        if process:
            kill_owned(process, job)
            result["returncode"] = process.returncode
    except Exception as exc:
        result.update(status="runner_error", message=f"{type(exc).__name__}: {exc}")
        if process:
            kill_owned(process, job)
            result["returncode"] = process.returncode
    finally:
        result["memory_guard"] = monitor.report() if monitor else {"enabled": False,
            "requested_limit_mib": memory_limit_mib}
        if job:
            job.close()
        elif process and os.name != "nt":
            # Reap descendants which outlived their successful group leader too.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        result["finished_at"] = now()
        result["duration_seconds"] = round(time.monotonic() - start, 6)
        result["figures"] = [relative(p, output) for p in sorted((attempt / "figures").glob("*.png"))
                             if not p.name.endswith(".part.png")
                             and within(p, (output,)) and p.stat().st_size > 0]
        result["partial_figures"] = result["status"] != "success"
        result["success"] = result["status"] == "success"
        # Preserve a source exception even if final PNG export hung and the
        # process timed out before it could finish writing the final protocol.
        checkpoint = attempt / "octave-state.json"
        if checkpoint.is_file():
            try:
                checkpoint_data = read_json(checkpoint)
                if isinstance(checkpoint_data.get("error"), dict):
                    result.setdefault("error", checkpoint_data["error"])
                result["source_phase"] = checkpoint_data.get("phase")
                result["source_returned_successfully"] = checkpoint_data.get("success") is True
            except (OSError, ValueError) as exc:
                result["checkpoint_warning"] = str(exc)
        captures = attempt / "capture-state.json"
        if captures.is_file():
            try:
                result.setdefault("capture_errors", read_json(captures).get("errors", []))
            except (OSError, ValueError) as exc:
                result["capture_warning"] = str(exc)
        write_json(attempt / "result.json", result)
        write_json(root / "result.json", result)
    if interrupted:
        raise KeyboardInterrupt
    return result
