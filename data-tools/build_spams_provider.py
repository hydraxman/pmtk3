"""Official source-only SPAMS build with reviewed LP64 BLAS and MEX width guards."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"data-tools"))
from build_native_providers import Builder,digest,write_json,archive_relative
from build_glmnet_provider import verified_download

SOURCE={"version":"SPAMS Matlab 2.6, 2017-02-27","license":"GPL-3.0-or-later",
        "url":"https://files.inria.fr/spams/spams-matlab-v2.6-2017-02-27.tar.gz",
        "sha256":"aa94ca04f49b0b9b511fa4ad25017a06f769a632f680b3bd1add871639def3e5"}
def materialize(work):
    archive=work/"downloads/spams-matlab-v2.6-2017-02-27.tar.gz"
    verified_download(SOURCE["url"],archive,SOURCE["sha256"],50*1024**2)
    folder=work/"sources/spams-2.6";records={}
    with tarfile.open(archive) as package:
        for member in package:
            if member.isdir():continue
            if not member.isfile():raise ValueError("Nonregular SPAMS archive member")
            relative=archive_relative(member.name)
            if relative.suffix.lower() not in {".h",".hpp",".cpp",".c",".m",".txt"} and relative.name not in {"COPYING","LICENSE","README"}:continue
            data=package.extractfile(member).read();sha=hashlib.sha256(data).hexdigest();target=folder/relative
            if target.exists() and digest(target)!=sha:raise ValueError(f"Modified pristine SPAMS source: {target}")
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():target.write_bytes(data)
            records[relative.as_posix()]={"sha256":sha,"bytes":len(data)}
    if "COPYING" not in records:raise ValueError("Official GPL3 license missing")
    write_json(work/"spams-sources.json",{**SOURCE,"files":records})
    return folder
def install(work,output):
    document=json.loads((output/"spams-build.json").read_text())
    if document["status"]!="built_not_loaded" or document["source"]!=SOURCE:raise ValueError("Unreviewed SPAMS build")
    if len(document["binaries"])!=1 or Path(document["binaries"][0]["file"]).name!="mexTrainDL.mex":
        raise ValueError("Only the reviewed Octave mexTrainDL.mex entry can be installed; MATLAB platform binaries are never replaced")
    stubs=list((ROOT/"pmtksupportCopy").rglob("mexTrainDL.m"))
    if len(stubs)!=1:raise ValueError("Ambiguous historical mexTrainDL documentation stub")
    folder=stubs[0].parent
    for b in document["binaries"]:
        source=Path(b["file"]);target=folder/source.name
        if digest(source)!=b["sha256"]:raise ValueError("SPAMS binary checksum mismatch")
        if target.exists() and digest(target)!=digest(source):raise ValueError("Refusing to overwrite an existing native module")
        if not target.exists():shutil.copyfile(source,target)
    shutil.copyfile(work/"sources/spams-2.6/COPYING",folder/"SPAMS-2.6-COPYING.txt")
    document["installation_directory"]=str(folder)
    write_json(folder/"spams-native-provider.json",document)
    print("Installed real mexTrainDL.mex beside the unchanged historical stub:",folder)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase",choices=("fetch","build","activate"),required=True)
    parser.add_argument("--octave-bin",type=Path)
    parser.add_argument("--output",type=Path,default=ROOT/"demo-results-integration/native-final")
    args=parser.parse_args();output=args.output.resolve();work=ROOT/".demo-runtime/native-providers"
    forbidden=(ROOT/"demo-results").resolve()
    if output==forbidden or forbidden in output.parents:raise ValueError("Never use main demo-results")
    if args.phase=="activate":install(work,output);return
    source=materialize(work)
    if args.phase=="fetch":return
    if not args.octave_bin:parser.error("--octave-bin required")
    builder=Builder(args.octave_bin,work,output,1);target=None
    document={"family":"spams","source":SOURCE,"source_manifest":str(work/"spams-sources.json"),
              "status":"build_failed","runtime_execution_verified":False}
    try:
        builder.audit_toolchain()
        directory=work/"build/spams-2.6";directory.mkdir(parents=True,exist_ok=True)
        config=builder.bin.parent/"include/octave-11.3.0/octave/octave-config.h"
        if "#  define OCTAVE_F77_INT_TYPE int32_t" not in config.read_text():
            raise ValueError("Bundled BLAS/LAPACK INTEGER32 ABI not confirmed")
        original=source/"dictLearn/mex/mexTrainDL.cpp";text=original.read_text()
        if text.count("void mexFunction(")!=1:raise ValueError("Pinned SPAMS gateway entry mismatch")
        text='#include "spams_mex_guard.h"\n'+text.replace("void mexFunction(","void spams_upstream_mex(")
        text+="""
static_assert(sizeof(INTM)==4 && sizeof(INTT)==4,"SPAMS and bundled BLAS must both use INTEGER32");
#ifdef _OPENMP
#error This reviewed provider must use upstream single-thread non-OpenMP branch
#endif
void mexFunction(int nlhs,mxArray *plhs[],int nrhs,const mxArray *prhs[]) {
    try {spams_validate(nlhs,nrhs,prhs);spams_upstream_mex(nlhs,plhs,nrhs,prhs);}
    catch(const std::exception &error){mexErrMsgIdAndTxt("PMTK:SPAMSNative","%s",error.what());}
}
"""
        bridge=directory/"mexTrainDL.cpp";bridge.write_text(text,encoding="utf-8")
        # Octave itself ships utils.h. SPAMS decomp.h's quoted include must
        # resolve to its own canonical linalg/utils.h, not Octave C++ classes.
        includes=["-iquote"+str(source/"linalg")]
        includes+=["-I"+str(source/p) for p in ("linalg","decomp","dictLearn","prox","utils")]
        target=directory/"mexTrainDL.mex"
        builder.run([builder.bin/"mkoctfile.exe","--mex","-O2","-std=gnu++11","-fno-openmp","-DUSE_BLAS_LIB",
                     "-I"+str(ROOT/"data-tools/native"),*includes,bridge,"-lblas","-llapack","-lxerbla","-o",target],directory)
        document.update(status="built_not_loaded",binaries=[{"file":str(target),"sha256":digest(target),"bytes":target.stat().st_size}],
                        gateway={"upstream_sha256":digest(original),"derived_sha256":digest(bridge),
                                 "guard_sha256":digest(ROOT/"data-tools/native/spams_mex_guard.h")},
                        abi={"MEX_dimensions":64,"SPAMS_INTM":32,"BLAS_INTT":32,"openmp":False,
                             "threads":"Official non-OpenMP branch uses one thread, including numThreads=-1",
                             "inputs":"Checked dense real double; original dictionary-learning implementation unchanged",
                             "header_routing":"GCC -iquote selects authentic SPAMS linalg/utils.h over Octave's unrelated utils.h; no algorithm/header edits",
                             "octave_config_sha256":digest(config)})
    except Exception as error:
        document["error"]=str(error);raise
    finally:
        document.update(toolchain=builder.toolchain,commands=builder.commands)
        previous=output/"spams-build.json"
        if previous.exists():
            saved=previous.with_name("spams-build.previous-"+digest(previous)[:12]+".json")
            if not saved.exists():shutil.copyfile(previous,saved)
            document["previous_build_manifest"]=str(saved)
        write_json(output/"spams-build.json",document)
    print("Genuine SPAMS mexTrainDL built; not activated or executed.")
if __name__=="__main__":main()
