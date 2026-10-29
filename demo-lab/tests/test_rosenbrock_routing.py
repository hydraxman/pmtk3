"""Single-symbol upstream routing, not a replacement Rosenbrock implementation."""
from pathlib import Path
import unittest

LAB = Path(__file__).resolve().parents[1]


class RosenbrockRoutingTests(unittest.TestCase):
    def setUp(self):
        self.source = (LAB / "octave/demo_lab_route_rosenbrock.m").read_text()

    def test_only_canonical_file_is_copied_not_foreign_directory_promoted(self):
        self.assertIn("'markSchmidt', 'Foreign', 'rosenbrock.m'", self.source)
        self.assertIn("target = fullfile(shims, 'rosenbrock.m')", self.source)
        self.assertNotIn("addpath(", self.source)
        self.assertNotIn("genpath(", self.source)
        self.assertIn("report.minimize_before, report.minimize_after", self.source)

    def test_binary_bytes_hashes_and_actual_origin_are_preserved(self):
        for token in ("fopen(source, 'rb')", "fopen([target '.copying'], 'wb')",
                      "isequal(bytes, copied)", "report.source_sha256", "report.shim_sha256",
                      "report.resolved = which('rosenbrock')"):
            self.assertIn(token, self.source)
        self.assertIn("clear rosenbrock", self.source)

    def test_known_four_output_contract_uses_upstream_not_new_math(self):
        self.assertIn("[value, gradient, hessian, third] = rosenbrock(ones(2,1))", self.source)
        self.assertIn("[802 -400; -400 200]", self.source)
        self.assertIn("third_derivative_finite", self.source)

    def test_absence_is_optional_and_new_manifest_fields_are_not_required(self):
        self.assertLess(self.source.index("if exist(source, 'file') ~= 2"),
                        self.source.index("fid = fopen(source, 'rb')"))
        self.assertIn("canonical_source_absent", self.source)
        setup = (LAB / "octave/demo_lab_setup.m").read_text()
        self.assertIn("demo_lab_route_rosenbrock(repo, shims)", setup)
        self.assertNotIn("plan.rosenbrock", setup)


if __name__ == "__main__":
    unittest.main()
