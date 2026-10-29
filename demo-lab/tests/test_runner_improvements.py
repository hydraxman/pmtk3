"""Parallelism, guarded execution and analytic contract tests; no fake demo passes."""
from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
import io
import json
import math
import os
from pathlib import Path
import sys
import subprocess
import threading
import time
import unittest
from unittest.mock import patch

from test_demo_lab import Fixture, LAB
import analytics_fixtures
import coordinator
import inventory
import run_demos
import runner
import path_plan


class ParallelRunnerTests(Fixture):
    def entries(self, count):
        return [inventory.source_metadata(self.source(f"entry{i}.m", f"%% Purpose {i}\nx={i};"), self.repo)
                for i in range(count)]

    def test_three_real_owned_subprocesses_and_only_coordinator_publishes(self):
        entries = self.entries(3)
        main_thread = threading.get_ident()
        snapshots = []
        seen_threads = set()
        counts = {"active": 0, "max": 0}
        lock = threading.Lock()
        catalog = inventory.build_inventory(self.repo, self.output)

        def worker(*args):
            with lock:
                counts["active"] += 1
                counts["max"] = max(counts["max"], counts["active"])
                seen_threads.add(threading.get_ident())
            try:
                return runner.run_entry(*args)
            finally:
                with lock:
                    counts["active"] -= 1

        def snapshot(batch):
            self.assertEqual(threading.get_ident(), main_thread)
            inventory.write_json(self.output / "progress.json", batch)
            run_demos.refresh(catalog, self.repo, self.output)
            snapshots.append(batch)

        # Actual Python child timeouts exercise ownership/concurrency, NOT an
        # Octave replacement and never an original-demo success.
        with patch.object(runner, "command_for", return_value=[
            sys.executable, "-c", "import os,time;print(os.getcwd(),flush=True);time.sleep(30)"
        ]):
            results, interrupted = coordinator.execute_batch(
                entries, self.repo, self.output, sys.executable, .8, (), "qt", 3, snapshot,
                worker=worker, progress=lambda *a, **k: None)
        self.assertFalse(interrupted)
        self.assertEqual(len(seen_threads), 3)
        self.assertEqual(counts["max"], 3)
        self.assertEqual([r["status"] for r in results], ["timeout"] * 3)
        self.assertEqual(len({r["attempt_id"] for r in results}), 3)
        self.assertTrue(all(not runner.pid_alive(r["pid"]) for r in results))
        cwd = [(self.output / r["log"]).read_text().strip() for r in results]
        self.assertEqual(len(set(cwd)), 3)
        self.assertEqual(snapshots[-1]["completed"], 3)
        final = inventory.read_json(self.output / "inventory.json")
        self.assertEqual({e["result"]["status"] for e in final["entries"]}, {"timeout"})

    def test_cancel_stops_active_trees_and_never_queues_remaining_sources(self):
        entries = self.entries(6)
        real_wait = coordinator.wait
        calls = 0

        def interrupt_once(*a, **k):
            nonlocal calls
            calls += 1
            if calls == 1:
                time.sleep(.15)
                raise KeyboardInterrupt
            return real_wait(*a, **k)

        with patch.object(coordinator, "wait", side_effect=interrupt_once), patch.object(
            runner, "command_for", return_value=[sys.executable, "-c", "import time;time.sleep(30)"]
        ):
            results, interrupted = coordinator.execute_batch(
                entries, self.repo, self.output, sys.executable, 10, (), "qt", 2,
                lambda state: None, progress=lambda *a, **k: None)
        self.assertTrue(interrupted)
        self.assertEqual(len(results), 2)
        self.assertEqual({r["status"] for r in results}, {"interrupted"})
        self.assertTrue(all(not runner.pid_alive(r["pid"]) for r in results))
        self.assertFalse(inventory.result_directory(self.output, entries[2]).exists())

    def test_unexpected_worker_exception_is_durable_not_a_pass(self):
        entry = self.entry()

        def broken(*a):
            raise RuntimeError("unit fixture worker failure")

        results, _ = coordinator.execute_batch(
            [entry], self.repo, self.output, "unused", 1, (), "qt", 1,
            lambda state: None, worker=broken, progress=lambda *a, **k: None)
        self.assertEqual(results[0]["status"], "runner_error")
        self.assertIn("unit fixture worker failure", (self.output / results[0]["log"]).read_text())
        self.assertEqual(inventory.current_result(entry, self.output)["status"], "runner_error")

    def test_error_fallback_preserves_original_exception_and_attempt_reference(self):
        entry = self.entry()
        root = inventory.result_directory(self.output, entry)
        old = root / "attempts/old"
        old.mkdir(parents=True)
        self.latest(entry, "running", runner_pid=os.getpid(),
                    attempt_result=(old / "result.json").relative_to(self.output).as_posix())
        inventory.write_json(old / "octave-state.json", {"error": {
            "identifier": "unit:original", "message": "engine exception", "stack": []}})
        state = coordinator.record_worker_error(entry, self.output, OSError("unit write failure"))
        self.assertEqual(state["status"], "runner_error")
        self.assertEqual(state["error"]["identifier"], "unit:original")
        self.assertTrue(state["previous_attempt_result"].endswith("attempts/old/result.json"))

    def test_cancel_during_initial_snapshot_still_reaps_workers(self):
        entries = self.entries(2)
        calls = 0

        def snapshot(state):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise KeyboardInterrupt

        with patch.object(runner, "command_for", return_value=[
            sys.executable, "-c", "import time;time.sleep(30)"
        ]):
            results, interrupted = coordinator.execute_batch(
                entries, self.repo, self.output, sys.executable, 10, (), "qt", 2,
                snapshot, progress=lambda *a, **k: None)
        self.assertTrue(interrupted)
        self.assertTrue(results)
        self.assertTrue(all(r["status"] == "interrupted" for r in results))
        self.assertTrue(all(not runner.pid_alive(r["pid"]) for r in results))

    def test_jobs_bounds_and_duplicate_ids_rejected(self):
        entry = self.entry()
        for jobs in (0, 4):
            with self.assertRaises(ValueError):
                coordinator.execute_batch([entry], self.repo, self.output, "", 1, (), "qt",
                                          jobs, lambda state: None)
        with self.assertRaises(ValueError):
            coordinator.execute_batch([entry, entry], self.repo, self.output, "", 1, (), "qt",
                                      2, lambda state: None)

    def test_basename_extension_id_and_windows_separators(self):
        entry = self.entry()
        entry["result"] = {"status": "pending"}
        for selector in ("example", "example.m", "EXAMPLE.M", "demos/example.m", r"demos\example.m"):
            self.assertEqual(runner.select_entries([entry], [selector], False, [], None), [entry])
        selected = runner.select_entries([entry], ["example", "example.m"], False, [], None)
        self.assertEqual(len(selected), 1)

    def test_timeout_keeps_checkpoint_original_exception_and_partial_artifacts(self):
        entry = self.entry()
        script = (
            "import os,pathlib,json,time;"
            "a=pathlib.Path(os.environ['DEMO_LAB_ATTEMPT']);"
            "(a/'octave-state.json').write_text(json.dumps({'phase':'final_capture',"
            "'success':False,'error':{'identifier':'unit:original','message':'original error','stack':[]}}));"
            "(a/'figures'/'incomplete.part.png').write_bytes(b'incomplete fixture');"
            "time.sleep(30)"
        )
        with patch.object(runner, "command_for", return_value=[sys.executable, "-c", script]):
            state = runner.run_entry(entry, self.repo, self.output, sys.executable, .5, ())
        self.assertEqual(state["status"], "timeout")
        self.assertEqual(state["error"]["identifier"], "unit:original")
        self.assertEqual(state["source_phase"], "final_capture")
        self.assertEqual(state["figures"], [])
        self.assertFalse(state["success"])

    def test_retained_failed_outcome_still_exits_one_when_resuming(self):
        entry = self.entry()
        self.latest(entry, "failed")
        with redirect_stdout(io.StringIO()):
            code = run_demos.main(["run", "--repo", str(self.repo), "--output", str(self.output),
                                   "--octave", sys.executable, "--jobs", "3", "--limit", "0"])
        self.assertEqual(code, 1)
        self.assertEqual(inventory.read_json(self.output / "progress.json")["completed"], 0)

    def test_isolated_python_cli_bootstraps_own_modules_without_site_install(self):
        self.entry()
        result = subprocess.run(
            [sys.executable, "-I", str(LAB / "run_demos.py"), "inventory",
             "--repo", str(self.repo), "--output", str(self.output)],
            capture_output=True, text=True, timeout=20, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.output / "index.html").is_file())

    def test_windows_snapshot_sharing_retry_keeps_old_json_valid(self):
        path = self.output / "state.json"
        inventory.write_json(path, {"old": True})
        replace = os.replace
        calls = 0

        def temporarily_locked(src, dst):
            nonlocal calls
            calls += 1
            if calls < 3:
                self.assertEqual(inventory.read_json(path), {"old": True})
                raise PermissionError("unit fixture sharing conflict")
            return replace(src, dst)

        with patch.object(inventory.os, "replace", side_effect=temporarily_locked), patch.object(
                inventory.time, "sleep"):
            inventory.write_json(path, {"new": True})
        self.assertEqual(calls, 3)
        self.assertEqual(inventory.read_json(path), {"new": True})


class SafetyAndPathTests(Fixture):
    def test_graphviz_is_not_arbitrarily_skipped_but_shell_destruction_is_blocked(self):
        good = self.source("renderer.m", "system('dot -Tsvg graph.dot -o graph.svg');")
        entry = inventory.source_metadata(good, self.repo)
        self.assertEqual(entry["safety"], [])
        self.assertEqual(len(entry["warnings"]), 1)
        self.assertEqual(inventory.default_status(entry), "pending")
        for command in ("system('rm -rf x')", "system('dot x & del x')", "system(command)"):
            blocked = inventory.source_metadata(self.source("blocked.m", command), self.repo)
            self.assertTrue(blocked["safety"])

    def test_local_handle_and_temp_cleanup_not_global_disk_deletion(self):
        for code in ("h = uicontrol();\ndelete(h);",
                     "fname = fullfile(tempdir(), 'x.dat');\ndelete(fname);"):
            entry = inventory.source_metadata(self.source("cleanup.m", code), self.repo)
            self.assertEqual(entry["safety"], [])
            self.assertTrue(entry["warnings"])
        entry = inventory.source_metadata(self.source("global.m", "delete(filename);"), self.repo)
        self.assertTrue(entry["safety"])

    def test_support_libsvm_is_opted_in_only_for_relevant_sources(self):
        unrelated = inventory.source_metadata(self.source("beta.m", "x=1;"), self.repo)
        svm = inventory.source_metadata(self.source("svm.m", "svmFit(X,y);"), self.repo)
        self.assertFalse(unrelated["needs_libsvm"])
        self.assertTrue(svm["needs_libsvm"])
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        legacy = self.repo / "pmtksupportCopy" / "libsvm-2.8" / "matlab"
        legacy.mkdir(parents=True)
        (legacy / "svmtrain.m").write_text("function svmtrain();end")
        plan = path_plan.build_path_plan(self.repo, self.repo / "demos/beta.m", False)
        self.assertFalse(any("libsvm" in p for p in plan["directories"]))
        self.assertTrue(any("legacy libsvm" in item["reason"] for item in plan["skipped"]))
        requested = path_plan.build_path_plan(self.repo, self.repo / "demos/svm.m", True)
        self.assertIn(str(legacy.resolve()), requested["directories"])
        self.assertIn("resolved_numerics", setup)
        self.assertIn("'-end'", setup)

    def test_print_and_drawnow_capture_use_original_or_builtin_without_recursion(self):
        capture = (LAB / "octave/demo_lab_capture.m").read_text()
        self.assertIn("original_print(handle", capture)
        self.assertNotRegex(capture, r"(?<![_\w])print\s*\(handle")
        drawnow = (LAB / "octave/hooks/drawnow.m").read_text()
        self.assertIn("builtin('drawnow'", drawnow)
        hook = (LAB / "octave/hooks/print.m").read_text()
        self.assertIn("original(varargin{:})", hook)
        self.assertIn("demo_lab_capture", hook)
        self.assertIn("unsafePrintPath", hook)


class AnalyticFixtureTests(Fixture):
    def test_six_reference_contracts_with_known_values_and_invariants(self):
        document = analytics_fixtures.reference_document()
        self.assertEqual(document["status"], "reference_only")
        self.assertIsNone(document["success"])
        self.assertEqual(len(document["fixtures"]), 6)
        fixtures = {name: entry["reference"] for name, entry in document["fixtures"].items()}
        self.assertEqual(fixtures["beta_posterior"]["posterior"], [9, 6])
        self.assertAlmostEqual(fixtures["beta_posterior"]["mean"], .6)
        self.assertAlmostEqual(fixtures["beta_posterior"]["variance"], .015)
        self.assertEqual(fixtures["ols_ridge"]["ols"], [.9, .9])
        self.assertAlmostEqual(fixtures["ols_ridge"]["ridge"][1], 4.5/5.75)
        self.assertAlmostEqual(sum(fixtures["pca2d"]["eigenvalues"]), 3.5)
        projector = fixtures["pca2d"]["principal_projector"]
        self.assertAlmostEqual(projector[0][0]+projector[1][1], 1)
        for fixture, key in (("mixture_em", "responsibilities"), ("hmm_forward_backward", "posterior")):
            for row in fixtures[fixture][key]:
                self.assertAlmostEqual(sum(row), 1)
        history = fixtures["mixture_em"]["log_likelihood_history"]
        self.assertTrue(all(b >= a-1e-12 for a, b in zip(history, history[1:])))
        self.assertAlmostEqual(fixtures["sprinkler"]["normalization"], 1)
        self.assertAlmostEqual(fixtures["sprinkler"]["wet_probability"], .6471)
        # Independent brute-force likelihood verifies scaled HMM reference.
        p = document["fixtures"]["hmm_forward_backward"]["inputs"]
        evidence = 0
        for value in range(16):
            states = [(value >> i) & 1 for i in range(4)]
            probability = p["initial"][states[0]]
            for t, state in enumerate(states):
                probability *= p["emission"][state][p["observations"][t]]
                if t:
                    probability *= p["transition"][states[t-1]][state]
            evidence += probability
        self.assertAlmostEqual(math.exp(fixtures["hmm_forward_backward"]["log_evidence"]), evidence)

    def test_comparison_rejects_nan_bool_missing_keys_and_shape_mismatches(self):
        expected = {"a": [1., 2.]}
        self.assertEqual(analytics_fixtures.compare(expected, {"a": [1+1e-10, 2]}), [])
        for actual in ({"a": [1]}, {"a": [True, 2]}, {"a": [float("nan"), 2]},
                       {"a": [1, 3]}, {"b": [1, 2]}):
            self.assertTrue(analytics_fixtures.compare(expected, actual))

    def test_reference_only_cli_never_claims_an_octave_pass(self):
        self.entry()
        with redirect_stdout(io.StringIO()):
            code = run_demos.main(["fixtures", "--repo", str(self.repo), "--output", str(self.output)])
        self.assertEqual(code, 0)
        document = inventory.read_json(self.output / "analytics-fixtures.json")
        self.assertEqual(document["status"], "reference_only")
        self.assertNotIn("attempt", document)
        self.assertTrue(all("octave" not in entry for entry in document["fixtures"].values()))
        self.assertFalse((self.output / "demos").exists())


if __name__ == "__main__":
    unittest.main()
