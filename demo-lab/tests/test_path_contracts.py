"""Numerical names must resolve to original PMTK semantics, not package homonyms."""
from __future__ import annotations

from pathlib import Path
import unittest

from test_demo_lab import Fixture, LAB
import path_plan


class PathContractTests(Fixture):
    def install_contract_sources(self):
        for relative in path_plan.PMTK_SEMANTIC_ORIGINS.values():
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("% Unit path fixture only; not executed\n")
        support = self.repo / "pmtksupportCopy/packages/lightspeed-test-version/logsumexp.m"
        support.parent.mkdir(parents=True)
        support.write_text("% Unit path fixture only; not executed\n")
        return support

    def test_pmtk_semantic_directories_are_preferred_without_promoting_old_support(self):
        source = self.source("example.m", "x=1;")
        support = self.install_contract_sources()
        plan = path_plan.build_path_plan(self.repo, source, False)
        expected = {str((self.repo / relative).parent.resolve())
                    for relative in path_plan.PMTK_SEMANTIC_ORIGINS.values()}
        self.assertEqual(set(plan["preferred_directories"]), expected)
        self.assertFalse(any("pmtksupportCopy" in p for p in plan["preferred_directories"]))
        contracts = {c["name"]: c for c in plan["critical_origins"]}
        self.assertEqual(contracts["normalize"]["expected"], str((self.repo / "matlabTools/stats/normalize.m").resolve()))
        self.assertEqual(contracts["logsumexp"]["expected"], str(support.resolve()))
        self.assertTrue(all(not c["resolution_error"] for c in contracts.values()))

    def test_ambiguous_support_logsumexp_is_explicit_not_arbitrary_fallback(self):
        source = self.source("example.m", "x=1;")
        self.install_contract_sources()
        other = self.repo / "pmtksupportCopy/packages/lightspeed-another-version/logsumexp.m"
        other.parent.mkdir(parents=True)
        other.write_text("% Ambiguous unit fixture, not executed\n")
        plan = path_plan.build_path_plan(self.repo, source, False)
        contract = next(c for c in plan["critical_origins"] if c["name"] == "logsumexp")
        self.assertIsNone(contract["expected"])
        self.assertIn("ambiguous", contract["resolution_error"])

    def test_missing_original_contract_sources_are_reported(self):
        source = self.source("example.m", "x=1;")
        plan = path_plan.build_path_plan(self.repo, source, False)
        self.assertTrue(all(c["resolution_error"] for c in plan["critical_origins"]))

    def test_runtime_checks_real_helper_semantics_after_pkg_load_and_precedence(self):
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        self.assertLess(setup.index("pkg('load', name)"), setup.index("plan.preferred_directories"))
        self.assertLess(setup.index("plan.preferred_directories"), setup.index("demo_lab_check_origins(plan, attempt)"))
        self.assertIn("clear normalize logsumexp process_options gaussLogprob", setup)
        checks = (LAB / "octave/demo_lab_check_origins.m").read_text()
        for name in ("normalize", "logsumexp", "process_options", "gaussLogprob"):
            self.assertIn(name, checks)
        self.assertIn("isscalar(partition)", checks)
        self.assertIn("partition-36", checks)
        self.assertIn("tabularFactorNormalize(factor)", checks)
        self.assertIn("isscalar(factor_partition)", checks)
        self.assertIn("factor_partition-378", checks)
        self.assertIn("'tabular_factor_probability_sum'", checks)
        self.assertIn("path-origins.json", checks)
        self.assertIn("demo_lab:pathOrigin", checks)


if __name__ == "__main__":
    unittest.main()
