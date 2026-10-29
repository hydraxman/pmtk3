import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audit_data import audit, main, recover


class AuditTests(unittest.TestCase):
    def test_mat_directory_comments_and_dynamic_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "demos").mkdir()
            (root / "data" / "images").mkdir(parents=True)
            (root / "bigData").mkdir()
            (root / "data" / "local.mat").write_bytes(b"fixture")
            (root / "demos" / "example.m").write_text(
                "% loadData('commented');\n"
                "%{\nloadData('blockComment');\n%}\n"
                "loadData('local');\n"
                "loadData('images', 'isMatFile', false);\n"
                "loadData('missing');\nloadData(dynamic);\n"
            )
            result = audit(root)
            self.assertEqual(result["referenced_datasets"], 3)
            self.assertEqual(result["available_datasets"], 2)
            entries = {item["name"]: item for item in result["datasets"]}
            self.assertEqual(entries["images"]["kind"], "directory")
            self.assertEqual(entries["missing"]["status"], "needs_investigation")

    def test_recovery_preserves_original_files_and_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            upstream = Path(temp) / "upstream"
            (upstream / "missing").mkdir(parents=True)
            (upstream / "missing" / "missing.mat").write_bytes(b"original")
            report = {"datasets": [{"name": "missing", "kind": "mat", "local_paths": []}]}
            with patch("audit_data.git", side_effect=["commit123", "missing/missing.mat"]):
                with patch("audit_data.subprocess.run") as run:
                    recovered = recover(root, upstream, report)
            run.assert_called_once()
            self.assertEqual(
                (root / "data" / "recovered" / "missing" / "missing.mat").read_bytes(),
                b"original",
            )
            self.assertEqual(recovered[0]["source_commit"], "commit123")
            self.assertEqual(len(recovered[0]["sha256"]), 64)

    def test_literal_mat_loads_folders_and_explicit_dynamic_names(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "demos").mkdir()
            (root / "data" / "images").mkdir(parents=True)
            support = root / "pmtksupportCopy" / "packages"
            support.mkdir(parents=True)
            (support / "rain.mat").write_bytes(b"fixture")
            package = root / ".demo-runtime" / "octave" / "octave-fixture-w64" / "mingw64" / "share" / "octave" / "packages"
            package.mkdir(parents=True)
            (package / "fisheriris.mat").write_bytes(b"fixture")
            (root / "demos" / "example.m").write_text(
                "loadFolder('images');\nload rain.mat;\n"
                "x = load('sat.mat');\ny = load('clown');\n"
                "load fisheriris;\n"
                "load('text.dat');\nload(variable);\n"
            )
            result = audit(root, ["yeastStress"])
            entries = {item["name"]: item for item in result["datasets"]}
            self.assertEqual(set(entries), {"images", "rain", "sat", "clown", "yeastStress", "fisheriris"})
            self.assertEqual(entries["images"]["kind"], "directory")
            self.assertEqual(entries["images"]["status"], "available")
            self.assertEqual(entries["rain"]["status"], "available")
            self.assertEqual(entries["fisheriris"]["status"], "available")
            self.assertEqual(result["additional_datasets"], ["yeastStress"])

    def test_fresh_recovery_creates_results_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("sys.argv", ["audit_data.py", "--repo", str(root), "--recover", "--upstream", str(root)]):
                with patch("audit_data.recover", return_value=[]):
                    main()
            self.assertTrue((root / "demo-results" / "data-recovery.json").is_file())
            self.assertTrue((root / "demo-results" / "data-audit.json").is_file())


if __name__ == "__main__":
    unittest.main()
