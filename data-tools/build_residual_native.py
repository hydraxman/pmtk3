"""Second bounded native build: full-width official libDAI and genuine GLMnet.

Separate from the frozen LIBLINEAR builder and parent vendor-patch installer.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "data-tools"), str(ROOT / "data-tools/native"), str(ROOT / "demo-lab")]
from build_native_providers import Builder, SOURCES, activate, digest, materialize, write_json
from libdai_fullwidth import prepare
from memory_guard import MemoryMonitor, memory_limit_bytes
from runner import WindowsJob, kill_owned


def libdai_stub_directory():
    matches=list((ROOT/"pmtksupportCopy").rglob("dai.m"))
    if len(matches)!=1:
        raise ValueError(f"Expected exactly one historical dai.m documentation stub, found {len(matches)}")
    return matches[0].parent


def activate_fullwidth_libdai(work,output):
    """Same-directory MEX priority, without altering the shared path planner."""
    document=json.loads((output/"libdai-build.json").read_text())
    if document["status"]!="built_not_loaded" or document.get("source")!=SOURCES["libdai"]:
        raise ValueError("Only a successful reviewed libDAI build can be activated")
    if len(document["binaries"])!=1 or Path(document["binaries"][0]["file"]).name!="dai.mex":
        raise ValueError("Expected exactly the reviewed genuine dai.mex entry")
    destination=libdai_stub_directory()
    for binary in document["binaries"]:
        source=Path(binary["file"]);target=destination/source.name
        if digest(source)!=binary["sha256"]:raise ValueError("Built libDAI checksum mismatch")
        if target.exists() and digest(target)!=digest(source):
            raise ValueError(f"Refusing to overwrite an existing native provider: {target}")
    activate("libdai",work,output)
    central=ROOT/"pmtksupportCopy/packages/nativeProviders/libdai"
    for binary in document["binaries"]:
        target=destination/Path(binary["file"]).name
        if not target.exists():shutil.copyfile(Path(binary["file"]),target)
    for license_name in ("libdai-LICENSE.txt","boost-LICENSE.txt"):
        shutil.copyfile(central/license_name,destination/license_name)
    manifest_path=central/"provider.json"
    active=json.loads(manifest_path.read_text())
    active["installation_directory"]=str(destination)
    active["installer_sha256"]=digest(Path(__file__))
    active["historical_stub"]={"file":str(destination/"dai.m"),"sha256":digest(destination/"dai.m"),
                               "reason":"The original .m stub precedes nativeProviders on the curated path; same-directory .mex wins.",
                               "actual_core_version":SOURCES["libdai"]["version"]}
    write_json(manifest_path,active)
    write_json(destination/"dai-native-provider.json",active)
    print(f"Installed genuine libDAI {SOURCES['libdai']['version']} beside historical stub: {destination}",flush=True)


def run_capped(command, cwd, environment, timeout=120):
    """Only locally compiled/verified native diagnostics, one child at a time."""
    limit = memory_limit_bytes(6144)
    process = subprocess.Popen(
        [str(x) for x in command], cwd=cwd, env=environment,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, creationflags=0x00000004,
    )
    job = None
    try:
        job = WindowsJob(process, limit)
        monitor = MemoryMonitor(process, limit)
        monitor.sample()
        job.resume(process)
        start = time.monotonic()
        while process.poll() is None:
            sample = monitor.sample()
            if max(sample.values()) > limit or job.memory_violation():
                raise RuntimeError("Owned native diagnostic exceeded 6144 MiB")
            if time.monotonic()-start > timeout:
                raise RuntimeError("Owned native diagnostic exceeded timeout")
            time.sleep(.05)
        stdout, stderr = process.communicate(timeout=10)
        record = {"command": [str(x) for x in command], "returncode": process.returncode,
                  "stdout": stdout, "stderr": stderr, "memory_guard": monitor.report(),
                  "timeout_seconds": timeout, "jobs": 1}
        if process.returncode:
            raise RuntimeError(f"Native diagnostic failed:\n{stdout}\n{stderr}")
        return record
    finally:
        if process.poll() is None:
            kill_owned(process, job)
        if job:
            job.close()


class ResidualBuilder(Builder):
    def build_fullwidth_libdai(self, source, boost):
        directory = self.work / "build/libdai-fullwidth"
        directory.mkdir(parents=True, exist_ok=True)
        derived = directory / "source"
        transformations = prepare(source, derived)
        includes = ["-I"+str(derived/"include"), "-I"+str(boost), "-I"+str(ROOT/"data-tools/native"),
                    "-I"+str(self.bin.parent/"include")]
        self.toolchain["fullwidth_integer_transformations"] = transformations
        test = directory / "bigint-width-tests.exe"
        self.run([self.bin/"g++.exe", "-std=gnu++11", "-O2", *includes,
                  ROOT/"data-tools/native/test_libdai_bigint.cpp", derived/"src/exceptions.cpp",
                  "-L"+str(self.bin.parent/"lib"), "-lgmpxx", "-lgmp", "-o", test])
        proof = run_capped([test], directory, self.env)
        proof["tests"] = json.loads(proof["stdout"])
        if not proof["tests"]["passed"]:
            raise RuntimeError("Full-width integer proof did not pass")
        proof["executable_sha256"] = digest(test)
        write_json(self.output/"libdai-bigint-validation.json", proof)
        self.toolchain["fullwidth_integer_proof"] = proof
        self.commands.append(proof)
        print("Full-width GMP boundary/exception/state tests passed before provider compilation.", flush=True)
        objects = self.objects(sorted((derived/"src").glob("*.cpp")), directory/"objects", includes)
        replacements = {
            "dai.cpp": [
                ('#include <iostream>', '#include <iostream>\n#include <memory>\n#include <limits>\n#include "libdai_mex_validation.h"', 1),
                ('void mexFunction(', 'void dai_mex_implementation(', 1),
                ('InfAlg *obj = newInfAlg( method, fg, props );',
                 'std::unique_ptr<InfAlg> obj(newInfAlg( method, fg, props ));', 1),
                ('reinterpret_cast<uint32_T *>(mxGetPr(QMAP_OUT))',
                 'static_cast<uint32_T *>(mxGetData(QMAP_OUT))', 1),
                ('qmap_p[n] = map_state[n];', 'qmap_p[n] = pmtk_dai_map_state(map_state[n]);', 1),
                ('delete obj;', '', 2),
            ],
            "matlab.cpp": [
                ('vector<long>', 'vector<size_t>', 4),
                ('(long)members[mi]', '(size_t)members[mi]', 2),
                ('long gezocht', 'size_t gezocht', 2),
                ('int n1 = mxGetM(psi);', 'mwSize n1 = mxGetM(psi);', 1),
                ('int n2 = mxGetN(psi);', 'mwSize n2 = mxGetN(psi);', 1),
            ],
        }
        bridge = []
        bridge_records = []
        for filename, edits in replacements.items():
            original = source/"src/matlab"/filename
            text = original.read_text()
            for old, new, count in edits:
                if text.count(old) != count:
                    raise RuntimeError(f"Pinned MEX ABI repair mismatch: {filename}: {old}")
                text = text.replace(old, new)
            if filename == "dai.cpp":
                text += """
void mexFunction(int nlhs, mxArray *plhs[], int nrhs, const mxArray *prhs[]) {
    try {
        if (nrhs == 3) {
            pmtk_dai_validate(prhs[0]);
            if (!mxIsChar(prhs[1]) || !mxIsChar(prhs[2]))
                mexErrMsgIdAndTxt("libDAI:Input", "Method and properties must be character strings.");
        }
        dai_mex_implementation(nlhs, plhs, nrhs, prhs);
    } catch (const dai::Exception &error) {
        mexErrMsgIdAndTxt("libDAI:Exception", "%s", error.what());
    } catch (const std::exception &error) {
        mexErrMsgIdAndTxt("libDAI:NativeException", "%s", error.what());
    }
}
"""
            target = directory/filename
            target.write_text(text, encoding="utf-8")
            bridge.append(target)
            bridge_records.append({"file": str(original), "upstream_sha256": digest(original),
                                   "derived": str(target), "derived_sha256": digest(target), "edits": edits})
        self.toolchain["mex_abi_repairs"] = bridge_records
        self.toolchain["mex_input_guard_sha256"] = digest(ROOT/"data-tools/native/libdai_mex_validation.h")
        target = directory/"dai.mex"
        self.run([self.bin/"mkoctfile.exe", "--mex", "-O2", "-std=gnu++11", *includes,
                  *bridge, *objects, "-L"+str(self.bin.parent/"lib"), "-lgmpxx", "-lgmp",
                  "-o", target], directory)
        return [target]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", choices=("libdai",), required=True)
    parser.add_argument("--phase", choices=("fetch","build","activate"), required=True)
    parser.add_argument("--octave-bin", type=Path)
    parser.add_argument("--jobs", choices=(1,2), type=int, default=1)
    parser.add_argument("--output", type=Path, default=ROOT/"demo-results-integration/native-continuation")
    args = parser.parse_args()
    output = args.output.resolve()
    forbidden = (ROOT/"demo-results").resolve()
    if output == forbidden or forbidden in output.parents:
        raise ValueError("Native continuation must not use main demo-results")
    work = ROOT/".demo-runtime/native-providers"
    if args.phase == "activate":
        activate_fullwidth_libdai(work, output)
        return
    source = materialize("libdai", work)
    boost = materialize("boost", work)
    if args.phase == "fetch":
        return
    if args.octave_bin is None:
        parser.error("--octave-bin is required for build")
    builder = ResidualBuilder(args.octave_bin, work, output, args.jobs)
    try:
        builder.audit_toolchain()
        binaries = builder.build_fullwidth_libdai(source, boost)
        builder.manifest("libdai", binaries, "built_not_loaded")
        print("libDAI full-width provider built; not activated or loaded.", flush=True)
    except Exception as error:
        builder.manifest("libdai", [], "build_failed", str(error))
        raise


if __name__ == "__main__":
    main()
