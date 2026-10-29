"""Verify one locally built native provider in one capped isolated Qt child."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/"demo-lab"),str(ROOT/"data-tools")]
from build_native_providers import SOURCES,digest
from build_glmnet_provider import SOURCE,activate_glmnet
from build_residual_native import activate_fullwidth_libdai,libdai_stub_directory
from diagnostics import diagnostic_entry
from inventory import read_json,write_json
from runner import DEFAULT_PACKAGES,OutputLock,resolve_octave,run_entry
from run_demos import validated_output

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family",choices=("libdai","glmnet"),required=True)
    parser.add_argument("--octave",required=True)
    parser.add_argument("--output",type=Path,default=ROOT/"demo-results-integration/native-continuation")
    parser.add_argument("--installed",action="store_true",help="Verify actual installed origin, not isolated build directory")
    parser.add_argument("--activate-after-proof",action="store_true")
    parser.add_argument("--timeout",type=float,default=120)
    args=parser.parse_args();output=validated_output(ROOT,args.output)
    forbidden=(ROOT/"demo-results").resolve()
    if output==forbidden or forbidden in output.parents:raise ValueError("Never use main demo-results for native diagnostics")
    if args.installed and args.activate_after_proof:parser.error("Choose build verification/activation OR installed verification")
    family=args.family;work=ROOT/".demo-runtime/native-providers"
    expected_source=SOURCE if family=="glmnet" else SOURCES["libdai"]
    folder=ROOT/("pmtksupportCopy/packages/glmnet-matlab" if family=="glmnet" else
                 "pmtksupportCopy/packages/nativeProviders/libdai")
    manifest_path=folder/("glmnet-native-provider.json" if family=="glmnet" else "provider.json")
    manifest=read_json(manifest_path if args.installed else output/(family+"-build.json"))
    if args.installed and family=="libdai":
        expected_folder=libdai_stub_directory()
        if Path(manifest.get("installation_directory",folder)).resolve()!=expected_folder.resolve():
            raise ValueError("Genuine libDAI has not been installed beside its historical stub")
        folder=expected_folder
    if manifest["source"]!=expected_source or manifest["status"] not in {"built_not_loaded","runtime_verified"}:
        raise ValueError("Unreviewed or unsuccessful native build")
    expected_build=work/"build"/("glmnet-2013" if family=="glmnet" else "libdai-fullwidth")
    for binary in manifest["binaries"]:
        origin=Path(binary["file"]).resolve()
        if origin.parent!=expected_build.resolve():raise ValueError("Provider not in reviewed local build directory")
        target=folder/origin.name if args.installed else origin
        if digest(target)!=binary["sha256"]:raise ValueError("Native provider binary checksum mismatch")
    if args.installed:os.environ["PMTK_NATIVE_TEST_INSTALLED"]="1"
    else:os.environ.pop("PMTK_NATIVE_TEST_INSTALLED",None)
    with OutputLock(output):
        state=run_entry(diagnostic_entry("native_"+family),ROOT,output,resolve_octave(args.octave),
                        args.timeout,DEFAULT_PACKAGES,"qt",memory_limit_mib=6144)
        print(f"Genuine {family} native contracts: {state['status']}",flush=True)
        if state["status"]!="success":
            print(json.dumps(state.get("error",{}),indent=2))
            print((output/state["log"]).read_text(encoding="utf-8",errors="replace")[-14000:])
            return 1
        artifact=(output/state["attempt_result"]).parent/(family+"-tests.json")
        tests=read_json(artifact)
        if not tests["passed"]:raise ValueError("Native numerical checks did not pass")
        expected_origin=(folder if args.installed else expected_build)/("glmnetMex.mex" if family=="glmnet" else "dai.mex")
        origin=tests.get("origin",tests.get("dai_origin"))
        if Path(origin).resolve()!=expected_origin.resolve():raise ValueError("A different provider won actual symbol resolution")
        report={"not_original_demo":True,"installed_origin":args.installed,"attempt":state,"tests":tests}
        report_path=output/(family+("-installed-validation.json" if args.installed else "-validation.json"))
        write_json(report_path,report)
        if args.activate_after_proof:
            if family=="glmnet":activate_glmnet(work,output)
            else:activate_fullwidth_libdai(work,output)
        if args.installed or args.activate_after_proof:
            active=read_json(manifest_path)
            active["status"]="runtime_verified";active["runtime_execution_verified"]=True
            active["verification"]={"report":str(report_path),"tested_installed_origin":args.installed,
                                    "octave_version":tests["octave_version"]}
            write_json(manifest_path,active)
            if family=="libdai":
                write_json(libdai_stub_directory()/"dai-native-provider.json",active)
        print(json.dumps(tests,indent=2));return 0

if __name__=="__main__":raise SystemExit(main())
