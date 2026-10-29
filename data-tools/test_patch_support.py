import contextlib
import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import patch_support


SOURCE = (
    "HessianIter = getOpt(o,'HESSIANITER',HessianIter);\n"
    "outputFcn = getOpt(o,'OUTPUTFCN',[]);\n"
    "useMex = getOpt(o,'USEMEX',1);\n"
    "useNegCurv = getOpt(o,'USENEGCURV',1);\n"
    "precFunc = getOpt(o,'PRECFUNC',[]);\n"
    "LS_type = getOpt(o,'LS_type',LS_type);\n"
)


class SupportPatchTests(unittest.TestCase):
    def prepare(self, root, source=SOURCE):
        support = root / "pmtksupportCopy" / "packages"
        target = support / "markSchmidt-9march2011" / "markSchmidt" / "minFunc" / "minFunc_processInputOptions.m"
        target.parent.mkdir(parents=True)
        target.write_text(source, encoding="utf-8")
        subprocess.run(["git", "-C", str(support), "init", "--quiet"], check=True)
        (root / "data-tools").mkdir()
        for filename, parts, _ in patch_support.PATCHES:
            patch = patch_support.ROOT / "data-tools" / filename
            shutil.copyfile(patch, root / "data-tools" / filename)
            for section in patch.read_text().split("diff --git ")[1:]:
                if "--- /dev/null" in section:
                    continue
                header = next(line for line in section.splitlines() if line.startswith("--- a/"))
                fixture = support.joinpath(*header[6:].split("/"))
                if fixture != target:
                    fixture.parent.mkdir(parents=True, exist_ok=True)
                    lines = [
                        line[1:] for line in section.splitlines()
                        if line.startswith((" ", "-")) and not line.startswith("---")
                    ]
                    fixture.write_text("\n".join(lines)+"\n", encoding="utf-8")
        (root / "data-tools" / "compatibility").mkdir()
        for filename, _, _ in patch_support.COMPATIBILITY_SOURCES:
            shutil.copyfile(
                patch_support.ROOT / "data-tools" / "compatibility" / filename,
                root / "data-tools" / "compatibility" / filename,
            )
        delegate = support / patch_support.RECOVERY_PROVENANCE["projectRandom2C.m"]["implementation_source"]
        delegate.parent.mkdir(parents=True, exist_ok=True)
        delegate.write_bytes(b"% installation fixture only; not a numerical backend\n")
        return target

    def test_patch_preserves_unrelated_edits_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = self.prepare(root, "% local comment\n" + SOURCE)
            with mock.patch.object(patch_support, "ROOT", root), mock.patch.object(
                patch_support.subprocess, "check_output", return_value="fixture-revision\n"
            ), contextlib.redirect_stdout(io.StringIO()):
                patch_support.main()
                once = target.read_bytes()
                patch_support.main()
            self.assertEqual(target.read_bytes(), once)
            self.assertTrue(target.read_text().startswith("% local comment\n"))
            self.assertIn("exist('lbfgsC','file') == 3", target.read_text())
            records = json.loads((root / "demo-results" / "support-patches.json").read_text())
            self.assertEqual(len(records), len(patch_support.PATCHES)+len(patch_support.COMPATIBILITY_SOURCES))
            netlab = next(record for record in records if record.get("patch", "").endswith("netlab-callables.patch"))
            self.assertEqual(len(netlab["patched_files"]), 11)
            recovered = next(record for record in records if record["file"].endswith("UGM_MFGibbsFreeEnergy.m"))
            self.assertEqual(recovered["kind"], "upstream_recovered_source")
            self.assertEqual(recovered["original_member_sha256"], "948c786b20393263cf3c2047da88e2962e07c12c3200bfa27251b85eba3aaa5f")
            projection = next(record for record in records if record["file"].endswith("projectRandom2C.m"))
            self.assertEqual(projection["source_commit"], "fixture-revision")
            self.assertEqual(len(projection["implementation_sha256"]), 64)

    def test_conflict_in_nonprimary_patch_file_preserves_every_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = self.prepare(root)
            hmc = root / "pmtksupportCopy" / "packages" / "netlab3.3" / "hmc.m"
            hmc.write_text("% locally replaced implementation\n", encoding="utf-8")
            before = target.read_bytes()
            with mock.patch.object(patch_support, "ROOT", root), self.assertRaisesRegex(
                RuntimeError, "conflicts with local source"
            ):
                patch_support.main()
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(hmc.read_text(), "% locally replaced implementation\n")

    def test_conflicting_local_change_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = self.prepare(root, SOURCE.replace("'USEMEX',1", "'USEMEX',7"))
            before = target.read_bytes()
            with mock.patch.object(patch_support, "ROOT", root), self.assertRaisesRegex(
                RuntimeError, "conflicts with local source"
            ):
                patch_support.main()
            self.assertEqual(target.read_bytes(), before)

    def test_modified_fallback_rejects_all_changes_before_patch_application(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = self.prepare(root)
            fallback = root / "pmtksupportCopy" / "packages" / "markSchmidt-9march2011" / "markSchmidt" / "KPM" / "max_mult.m"
            fallback.parent.mkdir()
            fallback.write_bytes(b"local implementation")
            before = target.read_bytes()
            with mock.patch.object(patch_support, "ROOT", root), self.assertRaisesRegex(
                RuntimeError, "Refusing to overwrite"
            ):
                patch_support.main()
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(fallback.read_bytes(), b"local implementation")

    def test_isolated_manifest_does_not_create_default_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.prepare(root)
            output = root / "isolated" / "provenance.json"
            with mock.patch.object(patch_support, "ROOT", root), mock.patch.object(
                patch_support.subprocess, "check_output", return_value="fixture-revision\n"
            ), contextlib.redirect_stdout(io.StringIO()):
                patch_support.main(output)
            self.assertTrue(output.is_file())
            self.assertFalse((root / "demo-results").exists())

    def test_modified_new_sources_reject_before_applying_any_patch(self):
        for filename in ("projectRandom2C.m", "UGM_MFGibbsFreeEnergy.m"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = self.prepare(root)
                parts = next(parts for name, parts, _ in patch_support.COMPATIBILITY_SOURCES if name == filename)
                destination = root.joinpath("pmtksupportCopy", "packages", *parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"% locally owned implementation\n")
                before = target.read_bytes()
                with mock.patch.object(patch_support, "ROOT", root), self.assertRaisesRegex(
                    RuntimeError, "Refusing to overwrite"
                ):
                    patch_support.main()
                self.assertEqual(target.read_bytes(), before)
                self.assertEqual(destination.read_bytes(), b"% locally owned implementation\n")

    def test_missing_authentic_delegate_rejects_before_any_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = self.prepare(root)
            delegate = root / "pmtksupportCopy" / "packages" / patch_support.RECOVERY_PROVENANCE["projectRandom2C.m"]["implementation_source"]
            delegate.unlink()
            before = target.read_bytes()
            with mock.patch.object(patch_support, "ROOT", root), self.assertRaisesRegex(
                RuntimeError, "pure projection implementation is missing"
            ):
                patch_support.main()
            self.assertEqual(target.read_bytes(), before)

    def test_recovered_ugm_has_original_mathematical_body(self):
        source = (patch_support.ROOT / "data-tools" / "compatibility" / "UGM_MFGibbsFreeEnergy.m").read_text()
        body = source[source.index("function [F]"):].replace(
            "function [F] = UGM_MFGibbsFreeEnergy(", "function [F] = MFGibbsFreeEnergy(", 1
        )
        # Original archive uses CRLF, a leading blank line and no final newline.
        original_bytes = ("\n"+body.rstrip("\n")).replace("\n", "\r\n").encode()
        self.assertEqual(
            hashlib.sha256(original_bytes).hexdigest(),
            patch_support.RECOVERY_PROVENANCE["UGM_MFGibbsFreeEnergy.m"]["original_member_sha256"],
        )
        self.assertIn("Copyright 2005-2015 Mark Schmidt", source)
        self.assertIn("THIS SOFTWARE IS PROVIDED BY THE AUTHOR", source)


if __name__ == "__main__":
    unittest.main()
