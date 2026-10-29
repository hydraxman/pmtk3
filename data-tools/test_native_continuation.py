"""Focused standard-library tests; numerical/native proof is deliberately separate."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(HERE),str(HERE/"native")]
import build_glmnet_provider as glmnet
import libdai_fullwidth as widths
import build_residual_native as residual

class FullWidthRepairTests(unittest.TestCase):
    def fixture(self,root):
        source=root/"pristine"
        for name,edits in widths.EDITS.items():
            target=source/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text("\n".join(old+"\n" for old,new,count in edits for _ in range(count)))
        util=source/"include/dai/util.h"
        util.write_text("#include <cerrno>\n"+widths.OLD_EXPORT+"\n")
        return source
    def test_exact_width_repairs_keep_pristine_and_are_repeatable(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=self.fixture(root);destination=root/"derived"
            before={p.relative_to(source):p.read_bytes() for p in source.rglob("*") if p.is_file()}
            first=widths.prepare(source,destination);second=widths.prepare(source,destination)
            self.assertEqual(first,second)
            self.assertEqual(len(first),len(widths.EDITS)+1)
            for name,data in before.items():self.assertEqual((source/name).read_bytes(),data)
            util=(destination/"include/dai/util.h").read_text()
            self.assertIn("mpz_import",util);self.assertIn("mpz_export",util)
            self.assertNotIn("return N.get_ui();",util)
            self.assertIn("DAI_ASSERT( N >= 0 )",util)
    def test_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=self.fixture(root)
            (source/"include/dai/index.h").write_text("Unexpected upstream version")
            with self.assertRaisesRegex(RuntimeError,"repair mismatch"):widths.prepare(source,root/"derived")
    def test_overlapping_trees_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=self.fixture(root)
            for target in (source,source/"derived",root):
                with self.assertRaises(ValueError):widths.prepare(source,target)
    def test_boundary_proof_contains_independent_oracles_and_rejections(self):
        text=(HERE/"native/test_libdai_bigint.cpp").read_text()
        for expected in ("2147483648","4294967296","9223372036854775808","18446744073709551615",
                         "18446744073709551616","-1","ASSERTION_FAILED","get_str()"):
            self.assertIn(expected,text)
    def test_native_routing_requires_one_unambiguous_historical_stub(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(residual,"ROOT",Path(temp)):
            with self.assertRaises(ValueError):residual.libdai_stub_directory()
            first=Path(temp)/"pmtksupportCopy/packages/legacy/dai.m"
            first.parent.mkdir(parents=True);first.write_text("% documentation only")
            self.assertEqual(residual.libdai_stub_directory(),first.parent)
            second=first.parent.parent/"another/dai.m";second.parent.mkdir();second.write_text("% another")
            with self.assertRaises(ValueError):residual.libdai_stub_directory()

class GlmnetSourceTests(unittest.TestCase):
    def test_network_content_verified_before_persisting(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/"download"
            with patch.object(glmnet.urllib.request,"urlopen",return_value=io.BytesIO(b"wrong")):
                with self.assertRaises(ValueError):glmnet.verified_download("https://official",target,"0"*64,20)
            self.assertFalse(target.exists())
    def test_cached_source_refuses_mutation_and_excess_size(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/"download";target.write_bytes(b"abc");sha=hashlib.sha256(b"abc").hexdigest()
            self.assertEqual(glmnet.verified_download("https://official",target,sha,3),b"abc")
            with self.assertRaises(ValueError):glmnet.verified_download("https://official",target,sha,2)
            with self.assertRaises(ValueError):glmnet.verified_download("https://official",target,"0"*64,3)
    def test_exact_archive_allowlist_does_not_extract_foreign_binaries(self):
        archive=io.BytesIO();sources={"GLMnet.f":b"official fortran","glmnetMex.F":b"official gateway"}
        with zipfile.ZipFile(archive,"w") as package:
            for name,data in sources.items():package.writestr("glmnet_matlab/"+name,data)
            package.writestr("glmnet_matlab/unknown.exe",b"never extract")
        spec=dict(glmnet.SOURCE);spec["files"]={name:hashlib.sha256(data).hexdigest() for name,data in sources.items()}
        def fake(url,path,sha,limit):
            if url==spec["url"]:return archive.getvalue()
            path.write_bytes(b"test license");return b"test license"
        with tempfile.TemporaryDirectory() as temp,patch.object(glmnet,"SOURCE",spec),patch.object(glmnet,"verified_download",side_effect=fake):
            source=glmnet.materialize_glmnet(Path(temp))
            self.assertEqual({p.name for p in source.iterdir()},{"GLMnet.f","glmnetMex.F","GPL-2.0.txt"})
            (source/"GLMnet.f").write_text("modified")
            with self.assertRaises(ValueError):glmnet.materialize_glmnet(Path(temp))
    def test_fortran_bridge_uses_fullwidth_host_dimensions_and_checked_int32(self):
        text=(HERE/"native/glmnet_legacy_bridge.cpp").read_text()
        for contract in ("mwSize dimensions[2]","product(ni,nx)","product(ni,nc)","product(product(nx,nc),nlam)",
                         "pmtk_glmnet_abi","integer_bits==32","real_bits==32","gaussian?100000:integer(prhs[13],1)"):
            self.assertIn(contract,text)
        self.assertNotIn("int dimensions[",text)
    def test_official_solver_is_not_mathematically_rewritten(self):
        self.assertEqual(glmnet.SOURCE["files"]["GLMnet.f"],
                         "6f59bd53ab3ce291ed86646c4cd7ea086def492b0a4a798dcd8d00d0bd0db7e6")
        text=(HERE/"build_glmnet_provider.py").read_text()
        self.assertIn('"-ffixed-line-length-72"',text)
        self.assertNotIn('"-fdefault-real-8"',text)
    def test_incomplete_activation_rejected_without_writing_provider(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            glmnet.write_json(root/"glmnet-build.json",{"status":"built_not_loaded","source":glmnet.SOURCE,"binaries":[]})
            with self.assertRaises(ValueError):glmnet.activate_glmnet(root,root)

if __name__=="__main__":unittest.main()
