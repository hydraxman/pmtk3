"""MATLAB-only early returns must never be represented as executed successes."""
from __future__ import annotations

from contextlib import redirect_stdout
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from test_demo_lab import Fixture, LAB
import gallery
import inventory
import run_demos
import runner

MEMORY_MAP = """%% MATLAB memory map example
function memoryMapDemo()
if isOctave()
    fprintf('Sorry this demo will only work in Matlab\\n');
    return
end
mapping = memmapfile('fixture.dat');
end
"""


class UnsupportedTests(Fixture):
    def unsupported_entry(self):
        return inventory.source_metadata(self.source("memoryMapDemo.m", MEMORY_MAP), self.repo)

    def test_matlab_memmap_guard_is_unsupported_not_a_nonvisual_success(self):
        entry = self.unsupported_entry()
        self.assertTrue(entry["runnable"])  # remains an original MATLAB candidate
        self.assertEqual(inventory.default_status(entry), "unsupported")
        state = inventory.current_result(entry, self.output)
        self.assertEqual(state["status"], "unsupported")
        self.assertFalse(state["success"])
        self.assertFalse(state["workload_executed"])
        self.assertEqual(state["execution_disposition"], "not_executed")
        self.assertEqual(state["requirement"], "MATLAB memmapfile")
        self.assertIn("before the demo workload", state["message"])

    def test_explicit_retries_cannot_schedule_unsupported_or_spawn_octave(self):
        entry = self.unsupported_entry()
        entry["result"] = inventory.current_result(entry, self.output)
        for statuses in ([], ["success"], ["unsupported"], list(inventory.TERMINAL_STATUSES)):
            self.assertEqual(runner.select_entries([entry], ["memoryMapDemo"], True, statuses, None), [])
        with patch.object(runner.subprocess, "Popen") as process:
            with self.assertRaisesRegex(ValueError, "Refusing"):
                runner.run_entry(entry, self.repo, self.output, sys.executable, 1)
            process.assert_not_called()

    def test_old_exit_zero_latest_success_is_reclassified_and_attempt_history_kept(self):
        entry = self.unsupported_entry()
        root = inventory.result_directory(self.output, entry)
        attempt = root / "attempts/old/result.json"
        old = self.latest(entry, "success", returncode=0,
                          attempt_result=attempt.relative_to(self.output).as_posix())
        inventory.write_json(attempt, old)
        data = inventory.build_inventory(self.repo, self.output)
        state = data["entries"][0]["result"]
        self.assertEqual(state["status"], "unsupported")
        self.assertFalse(state["success"])
        self.assertFalse(state["workload_executed"])
        self.assertEqual(state["superseded_report"]["status"], "success")
        inventory.save_inventory(data, self.output)
        latest = inventory.read_json(root / "result.json")
        self.assertEqual(latest["status"], "unsupported")
        self.assertFalse(latest["success"])
        self.assertFalse(latest["workload_executed"])
        self.assertEqual(inventory.read_json(attempt), old)
        # A second read/write must not turn it back into success.
        again = inventory.build_inventory(self.repo, self.output)
        inventory.save_inventory(again, self.output)
        self.assertEqual(again["entries"][0]["result"]["status"], "unsupported")
        text = gallery.build_gallery(again, self.repo, self.output).read_text(encoding="utf-8")
        self.assertIn('data-status="unsupported"', text)
        self.assertIn("MATLAB memmapfile", text)
        self.assertNotIn('data-status="success"', text)

    def test_unsupported_classification_is_persisted_without_an_execution_attempt(self):
        self.unsupported_entry()
        data = inventory.build_inventory(self.repo, self.output)
        inventory.save_inventory(data, self.output)
        entry = data["entries"][0]
        state = inventory.read_json(inventory.result_directory(self.output, entry) / "result.json")
        self.assertTrue(state["classification_only"])
        self.assertNotIn("attempt_id", state)
        self.assertNotIn("pid", state)
        self.assertEqual(data["counts"]["runnable_candidates"], 1)
        self.assertEqual(data["counts"]["unsupported_candidates"], 1)
        self.assertEqual(data["counts"]["feasible_candidates"], 0)

    def test_cli_explicit_unsupported_exits_one_without_starting_child(self):
        self.unsupported_entry()
        output = io.StringIO()
        with patch.object(runner.subprocess, "Popen") as process, redirect_stdout(output):
            code = run_demos.main(["run", "--repo", str(self.repo), "--output", str(self.output),
                                   "--octave", sys.executable, "--demo", "memoryMapDemo",
                                   "--retry-status", "unsupported"])
        self.assertEqual(code, 1)
        process.assert_not_called()
        self.assertIn("REFUSED memoryMapDemo: unsupported", output.getvalue())
        self.assertIn("MATLAB memmapfile", output.getvalue())

    def test_only_leading_unconditional_no_work_branch_is_excluded(self):
        unsupported = [
            "if isOctave()\nreturn\nend\nx=1;",
            "if isOctave(), disp('MATLAB only'); return; end\nx=1;",
            "if isOctave()\nreturn\nelse\nx=1;\nend",
        ]
        supported = [
            "if ~isOctave()\nreturn\nend\nx=1;",
            "x=1;\nif isOctave()\nreturn\nend",
            "if isOctave()\nx=1;\nelse\nx=2;\nend",
            "if isOctave()\nwarning('notice');\nend\nx=1;",
            "% if isOctave(); return; end\nx=1;",
            "x='if isOctave(); return; end';",
        ]
        for text in unsupported:
            self.assertTrue(inventory.octave_constraints(text), text)
        for text in supported:
            self.assertEqual(inventory.octave_constraints(text), [], text)

    def test_nonvisual_success_that_really_computes_remains_success(self):
        entry = self.entry()
        self.latest(entry, "success", returncode=0, figures=[])
        self.assertEqual(inventory.current_result(entry, self.output)["status"], "success")
        self.assertEqual(inventory.default_status(entry), "pending")

    def test_unsupported_engine_protocol_requires_exit_three_and_not_executed(self):
        path = self.repo / "unsupported-protocol.json"
        payload = {"source": "demos/memoryMapDemo.m", "completed": True, "success": False,
                   "status": "unsupported", "workload_executed": False, "requirement": "MATLAB memmapfile",
                   "error": {"identifier": "demo_lab:unsupported", "message": "Requires MATLAB memmapfile"}}
        inventory.write_json(path, payload)
        self.assertEqual(runner.validate_harness(path, 3, payload["source"])[0], "unsupported")
        self.assertEqual(runner.validate_harness(path, 0, payload["source"])[0], "runner_error")
        for overrides in ({"success": True}, {"workload_executed": True}, {"requirement": ""}):
            inventory.write_json(path, dict(payload, **overrides))
            self.assertEqual(runner.validate_harness(path, 3, payload["source"])[0], "runner_error")

    def test_optional_dependency_outcome_can_be_explicitly_retried_without_claiming_success(self):
        entry = self.entry()
        self.latest(entry, "unsupported", requirement="native libDAI MEX extension",
                    workload_executed=False, execution_disposition="dependency_unavailable",
                    error={"identifier": "PMTK:MissingLibdai", "message": "Native libdai missing"})
        entry["result"] = inventory.current_result(entry, self.output)
        self.assertEqual(inventory.default_status(entry), "pending")
        self.assertEqual(entry["result"]["status"], "unsupported")
        self.assertFalse(entry["result"]["success"])
        self.assertEqual(runner.select_entries([entry], [], False, ["unsupported"], None), [entry])
        self.assertEqual(runner.select_entries([entry], [], False, [], None), [])
        main = (LAB / "octave/demo_lab_main.m").read_text()
        self.assertIn("demo_lab_leading_dependency_guard(err)", main)
        self.assertIn("err.stack(1).file", main)
        self.assertIn("payload.execution_disposition = 'dependency_unavailable'", main)

    def test_explicit_native_dependency_preserves_error_and_never_uses_success_exit(self):
        path = self.repo / "native-dependency.json"
        error = {"identifier": "PMTK:MissingNativeDependency",
                 "message": "This demo requires a compatible native SPAMS mexTrainDL extension.",
                 "stack": [{"file": "demos/sparseDictDemo.m", "line": 12}]}
        payload = {"source": "demos/sparseDictDemo.m", "completed": True, "success": False,
                   "status": "unsupported", "workload_executed": False,
                   "execution_disposition": "dependency_unavailable", "requirement": error["message"],
                   "error": error}
        inventory.write_json(path, payload)
        status, actual = runner.validate_harness(path, 3, payload["source"])
        self.assertEqual(status, "unsupported")
        self.assertEqual(actual["error"], error)
        self.assertFalse(actual["success"])
        self.assertEqual(runner.validate_harness(path, 0, payload["source"])[0], "runner_error")
        # A normal undefined function remains a failed workload, not unsupported.
        ordinary = dict(payload, status="failed", error={"identifier": "Octave:undefined-function",
                                                        "message": "someFunction undefined"})
        inventory.write_json(path, ordinary)
        self.assertEqual(runner.validate_harness(path, 1, payload["source"])[0], "failed")
        main = (LAB / "octave/demo_lab_main.m").read_text()
        self.assertIn("{'PMTK:MissingLibdai', 'PMTK:MissingNativeDependency'}", main)
        self.assertIn("payload.requirement = err.message", main)
        self.assertIn("err.stack(1).line == guard_error_line", main)
        self.assertNotIn("strcmp(err.identifier, 'Octave:undefined-function')", main)

    def test_real_memory_map_source_is_excluded_without_editing_original(self):
        repo = LAB.parent
        source = repo / "demos/memoryMapDemo.m"
        if not source.exists():
            self.skipTest("Original repository absent")
        entry = inventory.source_metadata(source, repo)
        self.assertEqual(inventory.default_status(entry), "unsupported")
        self.assertEqual(entry["engine_constraints"][0]["requirement"], "MATLAB memmapfile")
        main = (LAB / "octave/demo_lab_main.m").read_text()
        self.assertLess(main.index("demo_lab_preflight();"), main.index("metadata = demo_lab_setup();"))
        self.assertIn("payload.status = 'unsupported'", main)
        self.assertIn("exit_code = 3", main)
        # Octave interprets \b through its string/regexp escape handling as
        # backspace; the real-engine preflight check caught this regression.
        self.assertNotIn(r"end\b", main)
        self.assertNotIn(r"'\bmemmapfile", main)


if __name__ == "__main__":
    unittest.main()
