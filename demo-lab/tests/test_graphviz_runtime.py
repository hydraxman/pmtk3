import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

import runner


@unittest.skipUnless(os.name == "nt", "The pinned Graphviz runtime is Windows-only")
class GraphvizRuntimeTests(unittest.TestCase):
    def prepare(self, root):
        octave = root / "octave-bin" / "octave-cli.exe"
        octave.parent.mkdir()
        octave.write_bytes(b"fixture octave")
        runtime = root / ".demo-runtime" / "graphviz"
        dot = runtime / "fixture" / "bin" / "dot.exe"
        dot.parent.mkdir(parents=True)
        dot.write_bytes(b"fixture dot")
        config = {
            "version": "fixture",
            "dot_relative": str(dot.relative_to(runtime)),
            "plugin_directory_relative": str(dot.parent.relative_to(runtime)),
            "dot_sha256": hashlib.sha256(dot.read_bytes()).hexdigest(),
        }
        manifest = runtime / "runtime.json"
        manifest.write_text(json.dumps(config), encoding="utf-8")
        return octave, dot, manifest, config

    def test_graphviz_is_child_local_after_octave_before_host_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            octave, dot, _, _ = self.prepare(root)
            inherited = {"PATH": "host-sentinel", "DEMO_LAB_REPO": str(root), "OMP_THREAD_LIMIT": "12"}
            environment, profile = runner.runtime_environment(str(octave), inherited)
            self.assertEqual(inherited["PATH"], "host-sentinel")
            self.assertEqual(inherited["OMP_THREAD_LIMIT"], "12")
            self.assertEqual(environment["OMP_THREAD_LIMIT"], "1")
            self.assertEqual(environment["PATH"].split(os.pathsep), [
                str(octave.parent), str(dot.parent), "host-sentinel",
            ])
            self.assertEqual(environment["GVBINDIR"], str(dot.parent))
            self.assertEqual(profile["graphviz"]["executable"], str(dot))

    def test_modified_binary_is_not_silently_used(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            octave, dot, _, _ = self.prepare(root)
            dot.write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "verified manifest"):
                runner.runtime_environment(str(octave), {"DEMO_LAB_REPO": str(root)})

    def test_external_binary_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            octave, _, manifest, config = self.prepare(root)
            outside = root / "outside.exe"
            outside.write_bytes(b"fixture dot")
            config["dot_relative"] = str(outside)
            manifest.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "escape"):
                runner.runtime_environment(str(octave), {"DEMO_LAB_REPO": str(root)})


if __name__ == "__main__":
    unittest.main()
