import contextlib
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import restore_legacy


class LegacyRecoveryTests(unittest.TestCase):
    def archive(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name in restore_legacy.FILES:
                archive.writestr(f"projects/Emt/{name}", f"% fixture: {name}\n")
        return buffer.getvalue()

    def test_exact_bytes_provenance_and_idempotence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "license.txt").write_bytes(b"fixture license")
            with mock.patch.object(restore_legacy, "ROOT", root), mock.patch.object(
                restore_legacy.subprocess, "check_output", return_value=self.archive()
            ), contextlib.redirect_stdout(io.StringIO()):
                restore_legacy.main()
                restore_legacy.main()
            manifest = json.loads((root / "demo-results" / "legacy-support-recovery.json").read_text())
            self.assertEqual(len(manifest), len(restore_legacy.FILES))
            for entry in manifest:
                self.assertEqual(entry["source_commit"], restore_legacy.REVISION)
                self.assertEqual(
                    entry["sha256"],
                    hashlib.sha256((root / entry["file"]).read_bytes()).hexdigest(),
                )
            self.assertEqual(
                (root / "pmtksupportCopy" / "packages" / "legacyEmt" / "PMTK-license.txt").read_bytes(),
                b"fixture license",
            )

    def test_modified_source_is_preserved_before_any_other_files_are_written(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "license.txt").write_bytes(b"fixture license")
            destination = root / "pmtksupportCopy" / "packages" / "legacyEmt"
            destination.mkdir(parents=True)
            modified = destination / Path(restore_legacy.FILES[-1]).name
            modified.write_bytes(b"local edits")
            with mock.patch.object(restore_legacy, "ROOT", root), mock.patch.object(
                restore_legacy.subprocess, "check_output", return_value=self.archive()
            ), self.assertRaisesRegex(RuntimeError, "Refusing to overwrite"):
                restore_legacy.main()
            self.assertEqual(modified.read_bytes(), b"local edits")
            self.assertEqual(list(destination.iterdir()), [modified])


if __name__ == "__main__":
    unittest.main()
