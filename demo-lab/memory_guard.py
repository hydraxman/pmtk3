"""Owned-process memory measurement, using only Windows APIs and ctypes."""
from __future__ import annotations

import ctypes
import os

DEFAULT_MEMORY_LIMIT_MIB = 6144 if os.name == "nt" else None
MEMORY_POLL_SECONDS = .15


def memory_limit_bytes(value: int | None) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value <= 0:
        raise ValueError("--memory-limit-mib must be a positive integer")
    limit = value * 1024 * 1024
    if limit > (1 << (ctypes.sizeof(ctypes.c_size_t) * 8)) - 1:
        raise ValueError("Memory limit does not fit this process architecture")
    if os.name != "nt":
        raise ValueError("The requested memory guard requires Windows; it cannot silently run unguarded")
    return limit


class MemoryMonitor:
    """Measure only the Popen-owned process handle, never an arbitrary name/PID."""
    def __init__(self, process, limit_bytes: int):
        from ctypes import wintypes as w

        class Counters(ctypes.Structure):
            _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                    "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]

        self.api = ctypes.WinDLL("psapi", use_last_error=True)
        self.api.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.POINTER(Counters), w.DWORD]
        self.api.GetProcessMemoryInfo.restype = w.BOOL
        self.counters_type = Counters
        self.process = process
        self.limit_bytes = limit_bytes
        self.peak_working_set_bytes = 0
        self.peak_private_bytes = 0
        self.last_sample = None
        self.violation = None

    def sample(self) -> dict:
        counters = self.counters_type()
        counters.cb = ctypes.sizeof(counters)
        if not self.api.GetProcessMemoryInfo(int(self.process._handle), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        self.last_sample = {"working_set_bytes": counters.WorkingSetSize,
                            "private_bytes": counters.PrivateUsage}
        self.peak_working_set_bytes = max(self.peak_working_set_bytes, counters.PeakWorkingSetSize)
        self.peak_private_bytes = max(self.peak_private_bytes, counters.PrivateUsage)
        return self.last_sample

    def report(self) -> dict:
        return {"enabled": True, "limit_bytes": self.limit_bytes,
                "poll_interval_seconds": MEMORY_POLL_SECONDS,
                "method": "Windows Job Object hard process/tree commit caps + GetProcessMemoryInfo",
                "job_commit_limit_bytes": self.limit_bytes,
                "peak_working_set_bytes": self.peak_working_set_bytes,
                "peak_sampled_private_bytes": self.peak_private_bytes,
                "last_sample": self.last_sample, "violation": self.violation}
