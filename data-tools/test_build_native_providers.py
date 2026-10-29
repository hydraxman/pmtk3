import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

import build_native_providers as native


class NativeBuildTests(unittest.TestCase):
    def test_pins_are_immutable_official_sources(self):
        for name, spec in native.SOURCES.items():
            self.assertRegex(spec["revision"], r"^[0-9a-f]{40}$")
            self.assertRegex(spec["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(spec["url"].startswith("https://"))
            self.assertNotIn("/master", spec["url"])
        self.assertIn("cjlin1/liblinear", native.SOURCES["liblinear"]["url"])
        self.assertIn("jorism/libdai", native.SOURCES["libdai"]["url"])
        self.assertIn("archives.boost.io", native.SOURCES["boost"]["url"])

    def test_unsafe_archive_paths_rejected(self):
        for member in ("../escape.c", "root/../../escape.c", "/root/escape.c",
                       "C:/escape.c", "root/C:/escape.c", "root\\..\\..\\escape.c"):
            with self.subTest(member=member), self.assertRaises(ValueError):
                native.archive_relative(member)
        self.assertEqual(native.archive_relative("root/matlab/train.c"), Path("matlab/train.c"))

    def fixture_archive(self, work, extra=()):
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("root/COPYRIGHT", "fixture license")
            archive.writestr("root/matlab/train.c", "/* source fixture, not executable */")
            archive.writestr("root/windows/train.exe", "never retain/run downloaded binary")
            for name, content in extra:
                archive.writestr(name, content)
        spec = dict(native.SOURCES["liblinear"], archive="fixture.zip",
                    sha256=hashlib.sha256(package.getvalue()).hexdigest())
        path = work / "downloads" / "fixture.zip"
        path.parent.mkdir(parents=True)
        path.write_bytes(package.getvalue())
        return spec

    def test_cached_source_checksum_license_and_idempotence(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            spec = self.fixture_archive(work)
            with mock.patch.dict(native.SOURCES, liblinear=spec), contextlib.redirect_stdout(io.StringIO()):
                destination = native.materialize("liblinear", work)
                native.materialize("liblinear", work)
            self.assertTrue((destination / "COPYRIGHT").is_file())
            self.assertFalse((destination / "windows/train.exe").exists())
            manifest = json.loads((work / "liblinear-sources.json").read_text())
            self.assertEqual(len(manifest["files"]), 2)

    def test_changed_source_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            spec = self.fixture_archive(work)
            with mock.patch.dict(native.SOURCES, liblinear=spec), contextlib.redirect_stdout(io.StringIO()):
                destination = native.materialize("liblinear", work)
                source = destination / "matlab/train.c"
                source.write_text("locally modified")
                with self.assertRaisesRegex(RuntimeError, "modified source"):
                    native.materialize("liblinear", work)
            self.assertEqual(source.read_text(), "locally modified")

    def test_bad_cache_checksum_stops_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            spec = self.fixture_archive(work)
            spec["sha256"] = "0"*64
            with mock.patch.dict(native.SOURCES, liblinear=spec), self.assertRaisesRegex(RuntimeError, "checksum"):
                native.materialize("liblinear", work)
            self.assertFalse((work / "sources").exists())

    def test_archive_traversal_is_not_written(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            spec = self.fixture_archive(work, [("root/../../../escape.c", "invalid")])
            with mock.patch.dict(native.SOURCES, liblinear=spec), self.assertRaises(ValueError):
                native.materialize("liblinear", work)
            self.assertFalse((work.parent / "escape.c").exists())

    def test_main_output_rejected_before_fetch_or_activation(self):
        with mock.patch("sys.argv", ["build", "--phase", "fetch", "--output", str(native.ROOT / "demo-results")]), \
                mock.patch.object(native, "materialize") as fetch, \
                self.assertRaisesRegex(ValueError, "main demo-results"):
            native.main()
        fetch.assert_not_called()

    def test_activation_refuses_unbuilt_or_tampered_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "isolated"
            output.mkdir()
            manifest = output / "liblinear-build.json"
            manifest.write_text(json.dumps({"status": "build_failed"}))
            with mock.patch.object(native, "ROOT", root), self.assertRaisesRegex(RuntimeError, "unsuccessful"):
                native.activate("liblinear", root / "work", output)
            binary = root / "test.mex"
            binary.write_bytes(b"fixture, not executed")
            manifest.write_text(json.dumps({"status": "built_not_loaded", "binaries": [
                {"file": str(binary), "sha256": "0"*64}
            ]}))
            with mock.patch.object(native, "ROOT", root), self.assertRaisesRegex(RuntimeError, "checksum"):
                native.activate("liblinear", root / "work", output)

    def test_compiler_failure_does_not_launch_rest_of_library(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            builder = native.Builder(root, root / "work", root / "output", jobs=1)
            sources = [root / f"part{i}.cpp" for i in range(12)]
            with mock.patch.object(builder, "run", side_effect=RuntimeError("compile fixture failure")) as command, \
                    self.assertRaisesRegex(RuntimeError, "compile fixture failure"):
                builder.objects(sources, root / "objects")
            command.assert_called_once()


if __name__ == "__main__":
    unittest.main()
