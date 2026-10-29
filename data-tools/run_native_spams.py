"""Verify genuine locally built SPAMS in one isolated 120s/6144-MiB Qt child."""
import argparse
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/"data-tools"),str(ROOT/"demo-lab")]
from build_spams_provider import SOURCE,install
from build_native_providers import digest
from diagnostics import diagnostic_entry
from inventory import read_json,write_json
from runner import DEFAULT_PACKAGES,OutputLock,resolve_octave,run_entry
from run_demos import validated_output

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--octave",required=True)
    parser.add_argument("--installed",action="store_true")
    parser.add_argument("--activate-after-proof",action="store_true")
    parser.add_argument("--output",type=Path,default=ROOT/"demo-results-integration/native-final")
    args=parser.parse_args();output=validated_output(ROOT,args.output)
    forbidden=(ROOT/"demo-results").resolve()
    if output==forbidden or forbidden in output.parents:raise ValueError("Never use main demo-results")
    if args.installed and args.activate_after_proof:parser.error("Choose build/activation or installed verification")
    work=ROOT/".demo-runtime/native-providers"
    stubs=list((ROOT/"pmtksupportCopy").rglob("mexTrainDL.m"))
    if len(stubs)!=1:raise ValueError("Ambiguous historical mexTrainDL stub")
    folder=stubs[0].parent
    manifest_path=folder/"spams-native-provider.json"
    manifest=read_json(manifest_path if args.installed else output/"spams-build.json")
    if manifest["source"]!=SOURCE or manifest["status"] not in {"built_not_loaded","runtime_verified"}:
        raise ValueError("Unreviewed SPAMS provider")
    binary=manifest["binaries"][0];built=Path(binary["file"])
    expected=folder/built.name if args.installed else built
    if digest(expected)!=binary["sha256"]:raise ValueError("SPAMS binary checksum mismatch")
    if args.installed:os.environ["PMTK_NATIVE_TEST_INSTALLED"]="1"
    else:os.environ.pop("PMTK_NATIVE_TEST_INSTALLED",None)
    with OutputLock(output):
        state=run_entry(diagnostic_entry("native_spams"),ROOT,output,resolve_octave(args.octave),
                        120,DEFAULT_PACKAGES,"qt",memory_limit_mib=6144)
        print("Genuine SPAMS contracts:",state["status"],flush=True)
        if state["status"]!="success":
            print(state.get("error"));print((output/state["log"]).read_text(errors="replace")[-12000:]);return 1
        tests=read_json((output/state["attempt_result"]).parent/"spams-tests.json")
        if not tests["passed"] or Path(tests["origin"]).resolve()!=expected.resolve():
            raise ValueError("Numerical proof or actual provider origin mismatch")
        report_path=output/("spams-installed-validation.json" if args.installed else "spams-validation.json")
        write_json(report_path,{"not_original_demo":True,"tests":tests,"attempt":state})
        if args.activate_after_proof:install(work,output)
        if args.installed or args.activate_after_proof:
            active=read_json(manifest_path);active["status"]="runtime_verified";active["runtime_execution_verified"]=True
            active["verification"]={"report":str(report_path),"tested_installed_origin":args.installed}
            write_json(manifest_path,active)
        print(tests);return 0
if __name__=="__main__":raise SystemExit(main())
