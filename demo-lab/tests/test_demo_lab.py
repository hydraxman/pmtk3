"""Stdlib unit/protocol tests. Synthetic protocol fixtures are NOT Octave runs."""
from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlsplit
from html.parser import HTMLParser

LAB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LAB))

import gallery
import inventory
import run_demos
import runner


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / "repo"
        self.output = self.repo / "results"
        (self.repo / "demos" / "markovLanguageEx").mkdir(parents=True)

    def source(self, name, text):
        path = self.repo / "demos" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def page(self, chapter, name, text=""):
        path = self.repo / "docs" / "demoOutput" / "bookDemos" / chapter / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def entry(self):
        return inventory.source_metadata(self.source("example.m", "%% Example purpose\nx = 1;\n"), self.repo)

    def latest(self, entry, initial_status, **extra):
        result = {"id": entry["id"], "source_sha256": entry["sha256"],
                  "status": initial_status, "success": initial_status == "success", **extra}
        inventory.write_json(inventory.result_directory(self.output, entry) / "result.json", result)
        return result


class InventoryTests(Fixture):
    def test_reconciliation_duplicate_chapters_indexes_missing_and_unmapped(self):
        self.source("alpha.m", "%% Alpha purpose\nx=1;\n")
        self.source("other.m", "function other()\n% Other purpose\nend\n")
        self.source("markovLanguageEx/helper.m", "function y=helper(x)\n% Convert x\ny=x;\nend")
        self.page("(1)-One", "alpha.html")
        self.page("(2)-Two", "alpha.html")
        self.page("(1)-One", "missing.html")
        self.page("(1)-One", "index.html")
        self.page("(2)-Two", "index.html")
        result = inventory.build_inventory(self.repo, self.output)
        c = result["counts"]
        self.assertEqual((c["m_files"], c["top_level_m_files"], c["nested_m_files"]), (3, 2, 1))
        self.assertEqual((c["html_pages"], c["raw_unique_html_stems"], c["raw_html_stem_duplicates"]), (5, 3, 2))
        self.assertEqual((c["published_demo_pages"], c["unique_published_demo_stems"],
                          c["chapter_demo_page_duplicates"]), (3, 2, 1))
        self.assertEqual((c["source_matched_pages"], c["source_matched_unique"],
                          c["source_missing_unique"], c["source_missing_pages"]), (2, 1, 1, 1))
        self.assertEqual(c["unmapped_sources"], 2)
        alpha = next(e for e in result["entries"] if e["name"] == "alpha")
        self.assertEqual(alpha["chapters"], ["(1)-One", "(2)-Two"])
        self.assertFalse(any(e["name"] == "index" for e in result["entries"]))
        self.assertEqual(len(result["entries"]), 4)

    def test_descriptions_and_tags(self):
        entry = inventory.source_metadata(self.source(
            "tagged.m", "% This file is from pmtk3.googlecode.com\n%PMTKslow\n%%\n"
            "%% Plot useful data <b>briefly</b>\n%PMTKneedsStatsToolbox foo\nx=1;"), self.repo)
        self.assertEqual(entry["description"], "Plot useful data briefly")
        self.assertEqual(entry["tags"][0], {"name": "slow", "value": ""})
        self.assertEqual(entry["tags"][1]["value"], "foo")

    def test_verified_historical_alias_attaches_page_to_existing_source(self):
        self.source("huberLossPlot.m", "%% Plot Huber loss\nx=1;\n")
        self.page("(7)-Regression", "huberLossDemo.html")
        data = inventory.build_inventory(self.repo, self.output)
        self.assertEqual(len(data["entries"]), 1)
        entry = data["entries"][0]
        self.assertEqual((entry["id"], entry["source"]), ("huberLossPlot", "demos/huberLossPlot.m"))
        self.assertEqual(entry["chapters"], ["(7)-Regression"])
        self.assertEqual(entry["published"][0]["source_resolution"], "historical_alias")
        self.assertEqual(entry["published"][0]["published_stem"], "huberLossDemo")
        alias = entry["historical_aliases"][0]
        self.assertEqual(alias["commit"], "302750aa3ad5c2ec1c5270502a4f0e453ddaaff7")
        self.assertEqual(alias["change"], "R100")
        self.assertEqual(data["counts"]["m_files"], 1)
        self.assertEqual(data["counts"]["runnable_candidates"], 1)
        self.assertEqual(data["counts"]["source_missing_unique"], 0)
        self.assertEqual(data["counts"]["historical_alias_pages"], 1)
        self.assertEqual(data["counts"]["unique_mapped_sources"], 1)
        self.assertEqual(entry["result"]["status"], "pending")
        for selector in ("huberLossDemo", "huberLossDemo.m", "demos/huberLossDemo.m"):
            self.assertEqual(runner.select_entries([entry], [selector], False, [], None), [entry])
        text = gallery.build_gallery(data, self.repo, self.output).read_text(encoding="utf-8")
        self.assertIn("huberLossDemo", text)
        self.assertIn(alias["commit"], text)
        self.assertIn("not an additional demo", text)

    def test_alias_across_chapters_does_not_duplicate_source_or_runnable_entry(self):
        self.source("huberLossPlot.m", "%% Huber loss\nx=1;")
        self.page("(1)-One", "huberLossDemo.html")
        self.page("(2)-Two", "huberLossDemo.html")
        self.page("(2)-Two", "huberLossPlot.html")
        data = inventory.build_inventory(self.repo, self.output)
        c = data["counts"]
        self.assertEqual(c["m_files"], 1)
        self.assertEqual(c["unique_inventory_entries"], 1)
        self.assertEqual(c["runnable_candidates"], 1)
        self.assertEqual(c["historical_alias_pages"], 2)
        self.assertEqual(c["historical_alias_unique"], 1)
        self.assertEqual(c["source_matched_unique"], 2)
        self.assertEqual(c["unique_mapped_sources"], 1)
        self.assertEqual(c["chapter_demo_page_duplicates"], 1)
        self.assertEqual(c["canonical_source_page_duplicates"], 2)
        self.assertEqual(len(data["entries"][0]["historical_aliases"]), 1)

    def test_exact_source_takes_precedence_over_alias(self):
        self.source("huberLossDemo.m", "%% Exact old source\nx=1;")
        self.source("huberLossPlot.m", "%% Current renamed source\nx=2;")
        self.page("(1)-One", "huberLossDemo.html")
        data = inventory.build_inventory(self.repo, self.output)
        old = next(e for e in data["entries"] if e["name"] == "huberLossDemo")
        new = next(e for e in data["entries"] if e["name"] == "huberLossPlot")
        self.assertEqual(old["published"][0]["source_resolution"], "exact_stem")
        self.assertEqual(new["chapters"], [])
        self.assertEqual(data["counts"]["historical_alias_pages"], 0)

    def test_absent_alias_target_stays_missing_and_kernel_alias_is_not_guessed(self):
        self.source("kernelRegressionDemo.m", "%% Similar spelling is not evidence\nx=1;")
        self.page("(1)-One", "huberLossDemo.html")
        self.page("(1)-One", "kernelRegrDemo.html")
        data = inventory.build_inventory(self.repo, self.output)
        self.assertEqual(data["counts"]["historical_alias_pages"], 0)
        missing = {e["name"] for e in data["entries"] if e["source"] is None}
        self.assertEqual(missing, {"huberLossDemo", "kernelRegrDemo"})

    def test_kernel_historical_alias_uses_svm_not_similarly_named_algorithm(self):
        self.source("svmRegrDemo.m", "%% Support vector regression\nx=1;")
        self.source("kernelRegressionDemo.m", "%% Different regression algorithm\nx=2;")
        self.page("(14)-Kernels", "kernelRegrDemo.html")
        data = inventory.build_inventory(self.repo, self.output)
        svm = next(e for e in data["entries"] if e["name"] == "svmRegrDemo")
        other = next(e for e in data["entries"] if e["name"] == "kernelRegressionDemo")
        self.assertEqual(len(data["entries"]), 2)
        self.assertEqual(data["counts"]["m_files"], 2)
        self.assertEqual(data["counts"]["source_missing_unique"], 0)
        self.assertEqual(svm["source"], "demos/svmRegrDemo.m")
        self.assertEqual(svm["chapters"], ["(14)-Kernels"])
        self.assertEqual(other["chapters"], [])
        self.assertEqual(other["historical_aliases"], [])
        alias = svm["historical_aliases"][0]
        self.assertEqual(alias["published_stem"], "kernelRegrDemo")
        self.assertEqual(alias["change"], "R100")
        self.assertEqual(alias["commit"], "302750aa3ad5c2ec1c5270502a4f0e453ddaaff7")
        for selector in ("kernelRegrDemo", "kernelRegrDemo.m", "demos/kernelRegrDemo.m"):
            self.assertEqual(runner.select_entries(data["entries"], [selector], False, [], None), [svm])

    def test_two_verified_aliases_have_zero_missing_and_no_extra_sources(self):
        self.source("huberLossPlot.m", "%% Huber loss\nx=1;")
        self.source("svmRegrDemo.m", "%% Support vector regression\nx=2;")
        self.page("(7)-Regression", "huberLossDemo.html")
        self.page("(14)-Kernels", "kernelRegrDemo.html")
        data = inventory.build_inventory(self.repo, self.output)
        c = data["counts"]
        self.assertEqual(c["m_files"], 2)
        self.assertEqual(c["runnable_candidates"], 2)
        self.assertEqual(c["unique_inventory_entries"], 2)
        self.assertEqual(c["historical_alias_pages"], 2)
        self.assertEqual(c["historical_alias_unique"], 2)
        self.assertEqual(c["source_matched_pages"], 2)
        self.assertEqual(c["source_matched_unique"], 2)
        self.assertEqual(c["unique_mapped_sources"], 2)
        self.assertEqual(c["source_missing_unique"], 0)
        self.assertEqual(c["source_missing_pages"], 0)
        self.assertEqual(c["canonical_source_page_duplicates"], 0)
        self.assertEqual({e["id"] for e in data["entries"]}, {"huberLossPlot", "svmRegrDemo"})

    def test_every_entry_has_honest_description(self):
        entry = inventory.source_metadata(self.source("blank.m", "x=1;\n"), self.repo)
        self.assertIn("no descriptive", entry["description"])

    def test_required_inputs_never_run_and_classifier_is_not_demo(self):
        for name, text in (
            ("requires.m", "function y=requires(x,y)\n% Purpose\nend"),
            ("markovLanguageEx/testLanguageClassifier.m", "function y=testC(a,b,func,varargin)\nend"),
            ("markovLanguageEx/getCounts.m", "function getCounts()\nend"),
        ):
            with self.subTest(name=name):
                entry = inventory.source_metadata(self.source(name, text), self.repo)
                self.assertFalse(entry["runnable"])
                self.assertEqual(inventory.default_status(entry), "helper")
        self.assertEqual(entry["kind"], "helper")

    def test_optional_defaults_zero_arg_examples_and_local_guard(self):
        for guard in ("if nargin < 1, x=1; end", "if nargin==0, x=1; end"):
            entry = inventory.source_metadata(self.source("optional.m", f"function optional(x)\n{guard}\nend"), self.repo)
            self.assertTrue(entry["runnable"])
            self.assertTrue(entry["optional_zero_args"])
        entry = inventory.source_metadata(self.source(
            "needs.m", "function needs(x)\ny=x;\nend\nfunction local(x)\nif nargin==0,x=1;end\nend"), self.repo)
        self.assertTrue(entry["requires_args"])
        entry = inventory.source_metadata(self.source(
            "ten.m", "function ten(x)\nif nargin < 10, y=1;end\nend"), self.repo)
        self.assertTrue(entry["requires_args"])

    def test_statistical_test_demo_not_legacy_test(self):
        demo = inventory.source_metadata(self.source("bayesTtestDemo.m", "x=1;"), self.repo)
        test = inventory.source_metadata(self.source("alarmFitTest.m", "x=1;"), self.repo)
        self.assertEqual(demo["kind"], "demo")
        self.assertEqual(test["kind"], "legacy_test")

    def test_safety_comments_strings_transpose_command_and_dynamic(self):
        safe = "% quit;\nx = 'system(''bad'')';\na = b';\nplot(a);\n"
        self.assertEqual(inventory.safety_findings(safe), [])
        for code in ("exit", "quit(0);", "system('bad');", "unix bad",
                     "cd /private/path", "!bad", "delete(filename)", "rmdir('x')",
                     "eval('quit')", "builtin('exit',0)", "initPmtk3Octave;"):
            with self.subTest(code=code):
                self.assertTrue(inventory.safety_findings(code))
        self.assertFalse(inventory.safety_findings("quit = uicontrol();"))

    def test_transitive_known_blocked_demo_is_blocked(self):
        self.source("bad.m", "function bad()\nsystem('bad');\nend")
        self.source("caller.m", "bad();")
        result = inventory.build_inventory(self.repo, self.output)
        self.assertEqual({e["result"]["status"] for e in result["entries"]}, {"blocked"})

    def test_images_are_local_and_contained(self):
        page = self.page("(1)-One", "alpha.html",
                         '<img src="a%20b.png"><img src="https://invalid/a.png">'
                         '<img src="file:///C:/bad.png"><img src="//host/a.png">'
                         '<img src="../../../../../../outside.png"><img src="evil.svg">')
        (page.parent / "a b.png").write_bytes(b"fixture")
        self.assertEqual(inventory.historical_images(page, self.repo),
                         ["docs/demoOutput/bookDemos/(1)-One/a b.png"])

    def test_persistent_json_csv_is_valid(self):
        self.entry()
        data = inventory.build_inventory(self.repo, self.output)
        inventory.save_inventory(data, self.output)
        self.assertEqual(inventory.read_json(self.output / "inventory.json")["counts"]["m_files"], 1)
        with (self.output / "inventory.csv").open(newline="", encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(rows[0]["status"], "pending")
        self.assertEqual(rows[0]["description"], "Example purpose")
        self.assertFalse(list(self.output.glob(".inventory*")))

    def test_real_repository_reconciliation(self):
        # Read-only regression against the original PMTK checkout, not a run.
        repo = LAB.parent
        if not (repo / "demos").exists():
            self.skipTest("Original repository not available")
        data = inventory.build_inventory(repo, self.output)
        c = data["counts"]
        for key, value in {"m_files": 570, "top_level_m_files": 565, "nested_m_files": 5,
                           "html_pages": 245, "raw_unique_html_stems": 221,
                           "raw_html_stem_duplicates": 24, "chapter_index_pages": 25,
                           "published_demo_pages": 220, "unique_published_demo_stems": 220,
                           "source_matched_unique": 220, "source_missing_unique": 0,
                           "historical_alias_pages": 2, "unique_mapped_sources": 220,
                           "chapter_demo_page_duplicates": 0}.items():
            self.assertEqual(c[key], value, key)
        self.assertEqual(c["helpers"] + c["runnable_candidates"], c["m_files"])
        self.assertTrue(all(e["description"] for e in data["entries"]))
        nested = [e for e in data["entries"] if e["id"].startswith("markovLanguageEx/")]
        self.assertEqual(len(nested), 5)
        self.assertFalse(any(e["runnable"] for e in nested))
        self.assertEqual(sum(e["kind"] == "legacy_test" for e in nested), 1)


class ResultAndSelectionTests(Fixture):
    def test_resume_skips_completed_and_retry_is_explicit(self):
        entries = []
        statuses = ["pending", "success", "failed", "timeout", "runner_error", "stale", "interrupted"]
        for i, status in enumerate(statuses):
            entry = self.entry()
            entry.update(id=str(i), result={"status": status})
            entries.append(entry)
        self.assertEqual([e["result"]["status"] for e in runner.select_entries(entries, [], False, [], None)],
                         ["pending", "stale", "interrupted"])
        self.assertEqual(len(runner.select_entries(entries, [], True, [], None)), 6)
        self.assertEqual(len(runner.select_entries(entries, [], True, ["success"], None)), 7)
        self.assertEqual(len(runner.select_entries(entries, [], True, ["success"], 2)), 2)
        self.assertEqual(runner.select_entries(entries, ["1"], False, [], None), [])
        self.assertEqual(runner.select_entries(entries, ["1"], False, ["success"], None), [entries[1]])

    def test_unknown_ambiguous_and_nonrunnable_selection(self):
        e = self.entry()
        e["result"] = {"status": "pending"}
        with self.assertRaisesRegex(ValueError, "Unknown"):
            runner.select_entries([e], ["absent"], False, [], None)
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            runner.select_entries([e, dict(e, id="nested/example")], ["example"], False, [], None)
        self.assertEqual(runner.select_entries([dict(e, runnable=False)], [], True, [], None), [])
        with self.assertRaisesRegex(ValueError, "Refusing"):
            runner.run_entry(dict(e, runnable=False), self.repo, self.output, "none", 1)

    def test_hash_changes_make_results_stale(self):
        e = self.entry()
        self.latest(e, "success")
        self.assertEqual(inventory.current_result(e, self.output)["status"], "success")
        updated = dict(e, sha256="changed")
        state = inventory.current_result(updated, self.output)
        self.assertEqual(state["status"], "stale")
        self.assertFalse(state["success"])

    def test_invalid_status_identity_or_success_is_visible_error(self):
        e = self.entry()
        for extra in ({"status": "invented"}, {"id": "wrong"}, {"status": "success", "success": False}):
            self.latest(e, "success", **extra)
            self.assertEqual(inventory.current_result(e, self.output)["status"], "runner_error")
        path = inventory.result_directory(self.output, e) / "result.json"
        path.write_text("{", encoding="utf-8")
        self.assertIn("Cannot read result", inventory.current_result(e, self.output)["message"])

    def test_abandoned_running_is_interrupted(self):
        e = self.entry()
        self.latest(e, "running", runner_pid=-1)
        self.assertEqual(inventory.current_result(e, self.output)["status"], "interrupted")
        self.latest(e, "running", runner_pid=os.getpid())
        self.assertEqual(inventory.current_result(e, self.output)["status"], "running")

    def test_result_directory_prevents_traversal_and_collisions(self):
        a = dict(self.entry(), name="../evil", id="../../evil")
        b = dict(a, id="different/evil")
        self.assertTrue(inventory.within(inventory.result_directory(self.output, a), (self.output,)))
        self.assertNotEqual(inventory.result_directory(self.output, a), inventory.result_directory(self.output, b))

    def test_protocol_requires_matching_exit_bool_identity_completion_and_error(self):
        path = self.repo / "fixture-protocol.json"
        good = {"success": True, "completed": True, "source": "demos/example.m"}
        # These are UNIT protocol fixtures, not claims that Octave ran.
        cases = [
            (good, 0, "success"), (good, 1, "runner_error"),
            (dict(good, success=False, error={"message": "unit fixture"}), 1, "failed"),
            (dict(good, success=False, error={"message": "unit fixture"}), 0, "runner_error"),
            (dict(good, success=False), 1, "runner_error"),
            (dict(good, success=1), 0, "runner_error"),
            (dict(good, source="other"), 0, "runner_error"),
            (dict(good, completed=False), 0, "runner_error"),
        ]
        for payload, code, status in cases:
            inventory.write_json(path, payload)
            self.assertEqual(runner.validate_harness(path, code, "demos/example.m")[0], status)
        self.assertEqual(runner.validate_harness(path.with_name("absent"), 0, "demos/example.m")[0], "runner_error")

    def test_command_no_shell_no_init_and_quote_escaping(self):
        command = runner.command_for(r"C:\Program Files\Octave\octave.exe", self.repo / "it's a lab")
        self.assertEqual(command[0], r"C:\Program Files\Octave\octave.exe")
        self.assertIn("--no-site-file", command)
        self.assertIn("--no-init-file", command)
        self.assertNotIn("--no-gui", command)
        self.assertIn("it''s a lab", command[-1])
        self.assertEqual(command[-2], "--eval")

    def test_timeout_terminates_owned_real_process_not_a_fake_octave_pass(self):
        e = self.entry()
        with patch.object(runner, "command_for", return_value=[sys.executable, "-c", "import time;time.sleep(30)"]):
            state = runner.run_entry(e, self.repo, self.output, sys.executable, .2, ())
        self.assertEqual(state["status"], "timeout", state)
        self.assertFalse(state["success"])
        self.assertFalse(runner.pid_alive(state["pid"]))
        self.assertTrue((self.output / state["attempt_result"]).is_file())
        self.assertTrue((self.output / state["log"]).is_file())
        self.assertTrue((self.output / state["log"]).parent.joinpath("work/figures").is_dir())
        self.assertLess(state["duration_seconds"], 25)

    def test_timeout_terminates_owned_child_tree(self):
        e = self.entry()
        script = ("import subprocess,sys,time;"
                  "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);"
                  "print(p.pid,flush=True);time.sleep(30)")
        with patch.object(runner, "command_for", return_value=[sys.executable, "-c", script]):
            state = runner.run_entry(e, self.repo, self.output, sys.executable, 1, ())
        self.assertEqual(state["status"], "timeout", state)
        child_pid = int((self.output / state["log"]).read_text().strip())
        deadline = time.monotonic() + 3
        while runner.pid_alive(child_pid) and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertFalse(runner.pid_alive(child_pid), f"Owned descendant {child_pid} survived")

    def test_exit_zero_without_protocol_is_runner_error_and_history_preserved(self):
        e = self.entry()
        with patch.object(runner, "command_for", return_value=[sys.executable, "-c", "print('not Octave')"]):
            first = runner.run_entry(e, self.repo, self.output, sys.executable, 10, ())
            second = runner.run_entry(e, self.repo, self.output, sys.executable, 10, ())
        self.assertEqual(first["status"], "runner_error")
        self.assertEqual(second["status"], "runner_error")
        self.assertNotEqual(first["attempt_id"], second["attempt_id"])
        self.assertTrue((self.output / first["attempt_result"]).is_file())
        self.assertEqual(inventory.current_result(e, self.output)["attempt_id"], second["attempt_id"])

    def test_lock_active_owner_refused(self):
        with runner.OutputLock(self.output):
            with self.assertRaisesRegex(RuntimeError, "holds"):
                with runner.OutputLock(self.output):
                    self.fail("Concurrent lock accepted")
        self.assertFalse((self.output / ".runner.lock").exists())

    def test_cli_builds_gallery_without_octave(self):
        self.entry()
        for command in ("inventory", "gallery"):
            with redirect_stdout(io.StringIO()):
                code = run_demos.main([command, "--repo", str(self.repo), "--output", str(self.output)])
            self.assertEqual(code, 0)
            self.assertTrue((self.output / "index.html").exists())
        with redirect_stderr(io.StringIO()):
            code = run_demos.main(["run", "--repo", str(self.repo), "--octave", "absent-demo-lab-octave",
                                   "--timeout", "nan"])
        self.assertEqual(code, 2)

    def test_output_must_not_overwrite_sources_runtime_support(self):
        for forbidden in ("demos", "docs", "pmtksupportCopy", ".demo-runtime", "demo-lab", ".git"):
            with self.assertRaises(ValueError):
                run_demos.validated_output(self.repo, self.repo / forbidden / "out")
        with self.assertRaises(ValueError):
            run_demos.validated_output(self.repo, self.repo)
        self.assertEqual(run_demos.validated_output(self.repo, None), self.repo / "demo-results")


class GalleryTests(Fixture):
    def test_escaping_offline_links_historical_labels_and_counts(self):
        self.entry()
        page = self.page("(1)-One & 'two'", "example.html", '<img src="preview.png">')
        (page.parent / "preview.png").write_bytes(b"unit image fixture")
        data = inventory.build_inventory(self.repo, self.output)
        e = data["entries"][0]
        e["description"] = '<script>alert("bad")</script>'
        e["result"].update(status="failed", message='<img src=x onerror="bad">', duration_seconds=1.25)
        figure = self.output / "new & fresh.png"
        figure.parent.mkdir(parents=True)
        figure.write_bytes(b"unit image fixture")
        e["result"]["figures"] = ["new & fresh.png", "../../outside.png"]
        path = gallery.build_gallery(data, self.repo, self.output)
        text = path.read_text(encoding="utf-8")
        self.assertNotIn('<script>alert', text)
        self.assertNotIn('<img src=x', text)
        self.assertIn("&lt;script&gt;", text)
        self.assertIn("NOT current execution", text)
        self.assertIn("PARTIAL / previous attempt", text)
        self.assertIn("1.250s", text)
        self.assertIn('data-status="failed"', text)
        self.assertIn("source_matched_unique", text)
        self.assertNotIn("https://", text)

        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.urls = []
            def handle_starttag(self, tag, attrs):
                self.urls.extend(value for key, value in attrs if key in ("href", "src"))
        parsed = Links()
        parsed.feed(text)
        for url in parsed.urls:
            self.assertFalse(urlsplit(url).scheme, url)
            target = self.output / unquote(urlsplit(url).path)
            self.assertTrue(inventory.within(target, (self.repo, self.output)), url)
            self.assertTrue(target.is_file(), url)

    def test_url_rejects_outside_and_escapes_special_characters(self):
        file = self.repo / 'a #?<".m'
        if os.name == "nt":
            file = self.repo / "a #&'.m"
        file.write_text("x", encoding="utf-8")
        url = gallery.local_url(file, self.output, self.repo)
        self.assertIn("%23", url)
        self.assertEqual((self.output / unquote(url)).resolve(), file.resolve())
        outside = Path(self.temporary.name) / "outside.png"
        outside.write_bytes(b"fixture")
        self.assertIsNone(gallery.local_url(outside, self.output, self.repo))

    def test_successful_nonvisual_demo_has_no_fabricated_images(self):
        e = self.entry()
        self.latest(e, "success", figures=[])
        data = inventory.build_inventory(self.repo, self.output)
        path = gallery.build_gallery(data, self.repo, self.output)
        text = path.read_text(encoding="utf-8")
        self.assertIn('data-status="success"', text)
        self.assertNotIn("<figure>", text)
        self.assertNotIn('src="http', text)

    def test_close_hook_never_recurses_and_setup_excludes_published_paths(self):
        close = (LAB / "octave/demo_lab_close.m").read_text()
        self.assertNotRegex(close, r"(?<![\w_])close\s*\(handle")
        self.assertIn("delete(handle)", close)
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        self.assertNotIn("genpath(repo)", setup)
        self.assertIn("'-end'", setup)
        main = (LAB / "octave/demo_lab_main.m").read_text()
        self.assertIn("builtin('exit', exit_code)", main)
        self.assertIn("'success', false", main)


if __name__ == "__main__":
    unittest.main()
