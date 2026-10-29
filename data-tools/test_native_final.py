"""Focused tests for explicit GLMnet path controls and safe SPAMS setup."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(HERE),str(HERE/"native")]
import glmnet_options
import build_spams_provider as spams

class FinalNativeTests(unittest.TestCase):
    def test_budget_audit_matches_both_authentic_cores(self):
        root=HERE.parent
        document=json.loads((HERE/"native/glmnet_iteration_semantics.json").read_text())
        for key in ("old_core","new_core"):
            self.assertEqual(hashlib.sha256((root/document[key]["source"]).read_bytes()).hexdigest(),document[key]["sha256"])
        self.assertEqual(document["bridge_defaults"]["gaussian_max_passes"],100000)
    def test_real_wrappers_have_guarded_matlab_routes(self):
        root=HERE.parent;work=root/".demo-runtime/native-providers"
        with tempfile.TemporaryDirectory() as temp:
            records=glmnet_options.prepare_wrappers(root,work,Path(temp))
            self.assertEqual(len(records),2)
            for record in records:
                self.assertEqual(hashlib.sha256(Path(record["file"]).read_bytes()).hexdigest(),record["patched_sha256"])
            body=(Path(temp)/"glmnet.m").read_text()
            self.assertIn("else\nif strcmp(family, 'gaussian')",body)
            self.assertIn("fit.octave_budget = native_budget",body)
            self.assertIn("options.octave_max_passes",body)
            self.assertIn("whole-path max_passes",body)
            settings=(Path(temp)/"glmnetSet.m").read_text()
            self.assertIn("if exist('OCTAVE_VERSION','builtin') ~= 0",settings)
            self.assertIn("options.octave_require_complete = false",settings)
    def test_pristine_wrapper_backup_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);backup=root/"original-wrappers/glmnet/glmnet.m"
            backup.parent.mkdir(parents=True);backup.write_text("changed")
            with self.assertRaises(ValueError):glmnet_options.prepare_wrappers(root,root,root/"derived")
    def test_native_complete_contract_is_not_warning_only(self):
        body=(HERE/"native/glmnet_legacy_bridge.cpp").read_text()
        self.assertIn("jerr!=0 || lmu!=nlam",body)
        self.assertIn("PMTK:GlmnetIncompletePath",body)
        self.assertIn('maxit=integer(limit,1)',body)
        self.assertIn('"explicit_octave_max_passes"',body)
    def test_spams_is_pinned_official_source_and_guarded_lp64(self):
        self.assertEqual(spams.SOURCE["sha256"],"aa94ca04f49b0b9b511fa4ad25017a06f769a632f680b3bd1add871639def3e5")
        body=(HERE/"build_spams_provider.py").read_text()
        for required in ("-fno-openmp","-iquote","sizeof(INTM)==4 && sizeof(INTT)==4","OCTAVE_F77_INT_TYPE int32_t"):
            self.assertIn(required,body)
        guard=(HERE/"native/spams_mex_guard.h").read_text()
        self.assertIn("sizeof(mwSize)==8",guard)
        self.assertIn("spams_product(k,k)",guard)
        self.assertIn("spams_product(k,batch)",guard)
    def test_spams_unsuccessful_activation_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"spams-build.json").write_text(json.dumps({"status":"build_failed","source":spams.SOURCE}))
            with self.assertRaises(ValueError):spams.install(root,root)

if __name__=="__main__":unittest.main()
