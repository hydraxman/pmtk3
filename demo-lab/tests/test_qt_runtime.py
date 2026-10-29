"""GUI-linked Qt support is explicit, child-local, and never uses offscreen QPA."""
import os
from pathlib import Path
import unittest

from test_demo_lab import Fixture
import runner


class QtRuntimeTests(Fixture):
    def runtime(self, gui=True, qt=True):
        prefix = self.repo / "runtime/mingw64"
        binary = prefix / "bin" / ("octave-gui.exe" if gui else "octave-cli.exe")
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b"unit fixture, not executable")
        if qt:
            (prefix / "qt6/bin").mkdir(parents=True)
            (prefix / "qt6/plugins/platforms").mkdir(parents=True)
        perl = prefix.parent / "usr/bin/perl.exe"
        perl.parent.mkdir(parents=True, exist_ok=True)
        perl.write_bytes(b"unit fixture, not executable")
        return binary, prefix

    def test_gui_command_disables_desktop_frontend_without_substituting_engine(self):
        gui = str(self.repo / "runtime/octave-gui.exe")
        console = str(self.repo / "runtime/octave-cli.exe")
        command = runner.command_for(gui, self.repo / "lab")
        self.assertEqual(command[0], gui)
        self.assertIn("--no-gui", command)
        self.assertIn("--no-init-file", command)
        self.assertNotIn("--no-gui", runner.command_for(console, self.repo / "lab"))

    @unittest.skipUnless(os.name == "nt", "Windows bundled Qt profile")
    def test_gui_environment_overrides_stale_offscreen_and_preserves_host_environment(self):
        binary, prefix = self.runtime()
        inherited = {"PATH": "host-sentinel", "QT_QPA_PLATFORM": "offscreen",
                     "QT_OPENGL": "desktop", "QT_PLUGIN_PATH": "foreign-plugins"}
        old = inherited.copy()
        environment, profile = runner.runtime_environment(str(binary), inherited)
        self.assertEqual(inherited, old)
        self.assertEqual(profile["binary_kind"], "gui")
        self.assertEqual(environment["QT_QPA_PLATFORM"], "windows")
        self.assertEqual(environment["QT_OPENGL"], "software")
        self.assertEqual(environment["QT_PLUGIN_PATH"], str(prefix / "qt6/plugins"))
        self.assertEqual(environment["QT_QPA_PLATFORM_PLUGIN_PATH"], str(prefix / "qt6/plugins/platforms"))
        self.assertEqual(environment["PATH"].split(os.pathsep)[:2],
                         [str(binary.parent), str(prefix / "qt6/bin")])
        self.assertTrue(environment["PATH"].endswith("host-sentinel"))

    def test_console_profile_never_implicitly_selects_gui_or_changes_qt_settings(self):
        binary, _ = self.runtime(gui=False)
        inherited = {"PATH": "host-sentinel", "QT_QPA_PLATFORM": "caller-value"}
        environment, profile = runner.runtime_environment(str(binary), inherited)
        self.assertEqual(profile["binary_kind"], "console")
        self.assertEqual(profile["executable"], str(binary))
        self.assertEqual(environment["QT_QPA_PLATFORM"], "caller-value")
        self.assertEqual(profile["qt_environment"], {})

    @unittest.skipUnless(os.name == "nt", "Windows bundled Qt profile")
    def test_missing_gui_qt_bundle_fails_explicitly_instead_of_using_foreign_plugins(self):
        binary, _ = self.runtime(qt=False)
        with self.assertRaisesRegex(ValueError, "bundled Qt"):
            runner.runtime_environment(str(binary), {"PATH": "host-sentinel"})


if __name__ == "__main__":
    unittest.main()
