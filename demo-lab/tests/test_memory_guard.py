"""Memory guards use real owned Python children, never claimed Octave passes."""
from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

from test_demo_lab import Fixture
import inventory
import memory_guard
import run_demos
import runner


class MemoryGuardTests(Fixture):
    def test_limit_validation_and_cli_configuration(self):
        self.assertIsNone(memory_guard.memory_limit_bytes(None))
        for value in (0, -1, True, 1.5, float("nan"), "6144"):
            with self.assertRaises(ValueError):
                memory_guard.memory_limit_bytes(value)
        if os.name == "nt":
            self.assertEqual(memory_guard.memory_limit_bytes(6144), 6 * 1024**3)
            self.assertEqual(memory_guard.DEFAULT_MEMORY_LIMIT_MIB, 6144)
        else:
            with self.assertRaises(ValueError):
                memory_guard.memory_limit_bytes(6144)
        args = run_demos.parser().parse_args(["run", "--octave", sys.executable,
                                             "--jobs", "3", "--memory-limit-mib", "6144"])
        self.assertEqual(args.memory_limit_mib, 6144)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = run_demos.main(["fixtures", "--repo", str(self.repo), "--output", str(self.output),
                                   "--memory-limit-mib", "0"])
        self.assertEqual(code, 2)

    def test_resource_outcome_is_durable_failed_and_explicitly_retryable(self):
        entry = self.entry()
        self.latest(entry, "resource_limit", success=False, message="Unit limit outcome")
        entry["result"] = inventory.current_result(entry, self.output)
        self.assertEqual(entry["result"]["status"], "resource_limit")
        self.assertFalse(runner.select_entries([entry], [], False, [], None))
        self.assertEqual(runner.select_entries([entry], [], True, [], None), [entry])
        self.assertEqual(runner.select_entries([entry], [], False, ["resource_limit"], None), [entry])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = run_demos.main(["run", "--repo", str(self.repo), "--output", str(self.output),
                                   "--octave", sys.executable])
        self.assertEqual(code, 1)  # retaining a prior resource failure cannot exit zero

    @unittest.skipUnless(os.name == "nt", "Windows native job/memory APIs")
    def test_native_commit_limit_preserves_partial_evidence_and_kills_owned_tree(self):
        entry = self.entry()
        program = f"""
import json,os,subprocess,sys
from pathlib import Path
attempt=Path(os.environ['DEMO_LAB_ATTEMPT'])
(attempt/'figures'/'unit-partial.png').write_bytes(b'unit test partial evidence, not an actual PNG')
(attempt/'octave-state.json').write_text(json.dumps({{'phase':'source_error','success':False,
 'error':{{'identifier':'unit:original','message':'prior source error','stack':[]}}}}))
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
Path('child.pid').write_text(str(child.pid))
try:
 allocation=bytearray(128*1024*1024)
except MemoryError:
 pass
# Deliberate synthetic exit-zero claim: the native limit notification MUST win.
(attempt/'octave-result.json').write_text(json.dumps({{'success':True,'completed':True,
 'source':{json.dumps(entry['source'])}}}))
"""
        with patch.object(runner, "command_for", return_value=[sys.executable, "-c", program]):
            state = runner.run_entry(entry, self.repo, self.output, sys.executable, 15, (),
                                      memory_limit_mib=64)
        self.assertEqual(state["status"], "resource_limit", state)
        self.assertFalse(state["success"])
        self.assertTrue(state["partial_figures"])
        self.assertEqual(len(state["figures"]), 1)
        self.assertEqual(state["error"]["identifier"], "unit:original")
        self.assertIn(state["memory_guard"]["violation"]["kind"], {"job_commit", "process_commit"})
        self.assertEqual(state["memory_guard"]["limit_bytes"], 64 * 1024**2)
        self.assertFalse(runner.pid_alive(state["pid"]))
        attempt = (self.output / state["attempt_result"]).parent
        child_pid = int((attempt / "work/child.pid").read_text())
        self.assertFalse(runner.pid_alive(child_pid))
        self.assertEqual(inventory.read_json(attempt / "result.json")["status"], "resource_limit")

    @unittest.skipUnless(os.name == "nt", "Windows native job/memory APIs")
    def test_sampled_working_set_limit_also_terminates_owned_process(self):
        entry = self.entry()
        sample = {"working_set_bytes": 64 * 1024**2 + 1, "private_bytes": 1024}
        with patch.object(runner, "command_for", return_value=[
            sys.executable, "-c", "import time;time.sleep(30)"
        ]), patch.object(memory_guard.MemoryMonitor, "sample", return_value=sample):
            state = runner.run_entry(entry, self.repo, self.output, sys.executable, 10, (),
                                      memory_limit_mib=64)
        self.assertEqual(state["status"], "resource_limit", state)
        self.assertFalse(state["success"])
        self.assertEqual(state["memory_guard"]["violation"]["kind"], "working_set_bytes")
        self.assertFalse(runner.pid_alive(state["pid"]))

    @unittest.skipUnless(os.name == "nt", "Windows native job/memory APIs")
    def test_measurement_failure_fails_closed_before_resuming_engine(self):
        entry = self.entry()
        with patch.object(runner, "command_for", return_value=[
            sys.executable, "-c", "import time;time.sleep(30)"
        ]), patch.object(memory_guard.MemoryMonitor, "sample", side_effect=OSError("unit measurement failure")):
            state = runner.run_entry(entry, self.repo, self.output, sys.executable, 10, (),
                                      memory_limit_mib=64)
        self.assertEqual(state["status"], "runner_error")
        self.assertFalse(state["success"])
        self.assertIn("unit measurement failure", state["message"])
        self.assertFalse(runner.pid_alive(state["pid"]))


if __name__ == "__main__":
    unittest.main()
