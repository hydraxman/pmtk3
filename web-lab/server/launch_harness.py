"""Bootstrap the existing CLI with embedded Python's isolated import path.

The provisioned embeddable distribution may omit the script directory from
sys.path. No packages are installed and no shared harness files are modified.
All arguments are forwarded verbatim to demo-lab/run_demos.py.
"""
from pathlib import Path
import runpy
import sys

repo = Path(__file__).resolve().parents[2]
script = repo / "demo-lab" / "run_demos.py"
sys.path.insert(0, str(script.parent))
sys.argv = [str(script), *sys.argv[1:]]
runpy.run_path(str(script), run_name="__main__")
