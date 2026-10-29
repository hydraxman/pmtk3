import unittest
from unittest import mock
import run_native_liblinear as driver


class NativeLiblinearDriverTests(unittest.TestCase):
    def test_main_output_is_rejected_before_provider_or_engine_access(self):
        with mock.patch("sys.argv", ["verify", "--octave", "unused"]), \
                mock.patch.object(driver, "validated_output", return_value=driver.ROOT / "demo-results"), \
                mock.patch.object(driver, "read_json") as read, \
                mock.patch.object(driver, "OutputLock") as lock, \
                self.assertRaisesRegex(ValueError, "isolated output"):
            driver.main()
        read.assert_not_called()
        lock.assert_not_called()

    def test_binary_tampering_is_rejected_before_launch(self):
        manifest = {"family": "liblinear", "status": "built_not_loaded",
                    "source": {"revision": driver.SOURCES["liblinear"]["revision"]},
                    "binaries": [{"file": "pmtk_liblinear_train.mex", "sha256": "0"*64}]}
        with mock.patch("sys.argv", ["verify", "--octave", "unused"]), \
                mock.patch.object(driver, "validated_output", return_value=driver.ROOT / "isolated-fixture"), \
                mock.patch.object(driver, "read_json", return_value=manifest), \
                mock.patch.object(driver, "digest", return_value="1"*64), \
                mock.patch.object(driver, "OutputLock") as lock, \
                mock.patch.object(driver, "run_entry") as run, \
                self.assertRaisesRegex(ValueError, "checksum"):
            driver.main()
        lock.assert_not_called()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
