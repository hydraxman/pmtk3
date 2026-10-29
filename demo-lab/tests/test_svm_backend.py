"""Provider wiring tests; numerical truth is verified separately in real Octave."""
from pathlib import Path
import subprocess
import sys

from test_demo_lab import Fixture, LAB

SVM = LAB.parent / "toolbox/SupervisedModels/svm"


class SvmProviderTests(Fixture):
    def test_platform_gate_keeps_native_octave_and_legacy_matlab_providers_distinct(self):
        source = (SVM / "svmLibsvmBackend.m").read_text()
        self.assertIn("exist('OCTAVE_VERSION', 'builtin')", source)
        self.assertIn("packages{k}.name, 'statistics'", source)
        self.assertIn("exist('svmtrain', 'file') == 3", source)
        self.assertIn("train_name = 'libsvmTrain'", source)
        self.assertIn("predict_name = 'svmLibMexPredict'", source)
        self.assertNotIn("catch", "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("%")))

    def test_classification_regression_and_modsel_share_one_adapter(self):
        self.assertIn("svmLibsvmBackend('train'", (SVM / "sub/svmlibFit.m").read_text())
        self.assertIn("svmLibsvmBackend('train'", (SVM / "svmModsel.m").read_text())
        self.assertIn("svmLibsvmBackend(''predict''", (SVM / "sub/svmlibPredict.m").read_text())
        self.assertIn("model.libsvmFields = fieldnames(model)", (SVM / "sub/svmlibFit.m").read_text())

    def test_training_transform_and_probability_label_contracts_are_explicit(self):
        fit = (SVM / "svmFit.m").read_text()
        predict = (SVM / "svmPredict.m").read_text()
        self.assertIn("model.svmPreprocess = struct", fit)
        self.assertIn("model.svmPreprocess.center", predict)
        self.assertIn("1:numel(model.ySupport)", predict)
        self.assertIn("probability = probability(:, order)", predict)
        self.assertIn("PMTK:SvmProbabilityUnavailable", predict)

    def test_singleton_fix_still_calls_same_native_provider_with_identical_rows(self):
        source = (SVM / "svmLibsvmBackend.m").read_text()
        self.assertIn("size(inputs{2}, 1) == 1", source)
        self.assertIn("inputs{2} = [inputs{2}; inputs{2}]", source)
        self.assertIn("provider.predict(inputs{:})", source)
        self.assertIn("values = values(1, :)", source)

    def test_numerical_driver_refuses_main_output_before_acquiring_lock(self):
        destination = self.repo / "demo-results"
        result = subprocess.run([sys.executable, str(LAB / "tests/run_svm_backend.py"),
                                 "--repo", str(self.repo), "--output", str(destination),
                                 "--octave", "not-resolved-for-this-test"],
                                capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("isolated output", result.stderr)
        self.assertFalse(destination.exists())
