"""Compatibility for new Octave code under a cached, older Python producer."""
from pathlib import Path
import unittest

LAB = Path(__file__).resolve().parents[1]


class PlanCompatibilityTests(unittest.TestCase):
    def test_completion_runs_before_any_new_manifest_field_is_accessed(self):
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        complete = setup.index("demo_lab_complete_path_plan(plan, repo)")
        self.assertLess(complete, setup.index("added = plan.directories"))
        self.assertLess(complete, setup.index("plan.preferred_directories"))
        self.assertLess(complete, setup.index("demo_lab_check_origins(plan, attempt)"))

    def test_legacy_defaults_include_all_new_fields_and_original_normalizer(self):
        complete = (LAB / "octave/demo_lab_complete_path_plan.m").read_text()
        for name in ("preferred_directories", "critical_origins", "candidate_function_names", "skipped"):
            self.assertIn(f"isfield(plan, '{name}')", complete)
        self.assertIn("fullfile(repo, 'matlabTools', 'stats')", complete)
        self.assertIn("'normalize.m'", complete)
        self.assertIn("'logsumexp'", complete)
        self.assertIn("'Missing or ambiguous support logsumexp origin'", complete)

    def test_old_runner_missing_new_binary_environment_has_local_fallback(self):
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        self.assertIn("isempty(getenv('DEMO_LAB_OCTAVE'))", setup)
        self.assertIn("canonicalize_file_name(program_invocation_name())", setup)
        self.assertIn("runtime_executable_compatibility_default", setup)


if __name__ == "__main__":
    unittest.main()
