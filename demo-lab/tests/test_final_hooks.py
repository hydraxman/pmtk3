"""Focused contracts for bounded capability/render/help harness changes."""
from pathlib import Path
import unittest

LAB = Path(__file__).resolve().parents[1]


class FinalHookTests(unittest.TestCase):
    def test_libdai_legacy_alias_delegates_to_unshadowed_original_predicate(self):
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        alias = (LAB / "octave/hooks/libdaiInstalled.m").read_text()
        self.assertIn("answer = isLibdaiInstalled();", alias)
        self.assertIn("dai_native = isLibdaiInstalled();", setup)
        self.assertNotIn("demo_lab_helper(shims, 'isLibdaiInstalled'", setup)
        self.assertNotIn("demo_lab_helper(shims, 'libdaiInstalled'", setup)
        self.assertIn("'predicate_origin', which('isLibdaiInstalled')", setup)

    def test_modern_scatter_not_coerced_to_gnuplot_or_made_visible(self):
        export = (LAB / "octave/demo_lab_prepare_export.m").read_text()
        self.assertIn("findall(handle, 'type', 'scatter')", export)
        self.assertIn("demo_lab:headlessScatter", export)
        self.assertNotIn("'visible', 'on'", export)
        modern = export[:export.index("if ~isempty(selected)")]
        self.assertNotIn("graphics_toolkit(handle, selected)", modern)
        self.assertIn("candidate = {'qt'}", modern)

    def test_makeinfo_is_runtime_pinned_core_scoped_and_stdout_only(self):
        validator = (LAB / "octave/demo_lab_makeinfo_command.m").read_text()
        for requirement in ("DEMO_LAB_OCTAVE", "core_formatter", "'__makeinfo__'",
                            "'--output=-'", "'exampleindent=2'", "'octave-help-'"):
            self.assertIn(requirement, validator)
        guard = (LAB / "octave/demo_lab_system.m").read_text()
        self.assertIn("command = demo_lab_makeinfo_command(tokens)", guard)
        self.assertIn("Shell operators/expansions are not permitted", guard)


if __name__ == "__main__":
    unittest.main()
