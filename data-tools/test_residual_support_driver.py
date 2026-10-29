import unittest
from unittest import mock

import run_residual_support


class ResidualDriverTests(unittest.TestCase):
    def test_main_output_is_rejected_before_lock_or_engine_resolution(self):
        with mock.patch("sys.argv", ["run_residual_support.py", "--octave", "unused"]), \
                mock.patch.object(run_residual_support, "validated_output", return_value=run_residual_support.ROOT / "demo-results"), \
                mock.patch.object(run_residual_support, "OutputLock") as lock, \
                mock.patch.object(run_residual_support, "resolve_octave") as resolve, \
                self.assertRaisesRegex(ValueError, "isolated output"):
            run_residual_support.main()
        lock.assert_not_called()
        resolve.assert_not_called()


if __name__ == "__main__":
    unittest.main()
