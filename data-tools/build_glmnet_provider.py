"""Pinned official GLMnet Fortran build, separate from parent/frozen installers."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/"data-tools"),str(ROOT/"data-tools/native")]
from build_native_providers import Builder, digest, write_json
from glmnet_options import prepare_wrappers

SOURCE = {
    "version":"newGLMnet 2013-02-15, official Matlab release 2014-04-28",
    "url":"https://hastie.su.domains/glmnet_matlab/glmnet_matlab.zip",
    "sha256":"4e7970e13ad6cdf6fa324e53496db4e77ae389c1793ae07073d7854c52e9e4e9",
    "license":"GPL-2.0",
    "license_canonical_url":"https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt",
    "license_url":"https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-15.2.0/COPYING",
    "license_sha256":"231f7edcc7352d7734a96eef0b8030f77982678c516876fcb81e25b32d68564c",
    "files":{
        "GLMnet.f":"6f59bd53ab3ce291ed86646c4cd7ea086def492b0a4a798dcd8d00d0bd0db7e6",
        "glmnetMex.F":"619ccb6484233b888d3e7de6829c40bf1f623f37c918fbecd820596462759c7e",
    },
}

def verified_download(url,path,sha,limit):
    if path.exists():
        if path.stat().st_size>limit or digest(path)!=sha:
            raise ValueError(f"Cached official source checksum/size mismatch: {path}")
        return path.read_bytes()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=45) as response:
                content=response.read(limit+1)
            break
        except (urllib.error.URLError,TimeoutError):
            if attempt==2:raise
            time.sleep(attempt+1)
    if len(content)>limit or hashlib.sha256(content).hexdigest()!=sha:
        raise ValueError("Official source exceeds size limit or differs from pinned checksum")
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(content)
    return content

def materialize_glmnet(work):
    archive=verified_download(SOURCE["url"],work/"downloads/glmnet_matlab-2014.zip",SOURCE["sha256"],4*1024**2)
    destination=work/"sources/glmnet-2013"
    destination.mkdir(parents=True,exist_ok=True)
    records={}
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        # Exact allowlist: never extract/run foreign platform MEXes in the ZIP.
        for name,sha in SOURCE["files"].items():
            content=package.read("glmnet_matlab/"+name)
            if hashlib.sha256(content).hexdigest()!=sha: raise ValueError("Official Fortran source checksum mismatch")
            target=destination/name
            if target.exists() and digest(target)!=sha: raise ValueError(f"Modified pristine GLMnet source: {target}")
            if not target.exists(): target.write_bytes(content)
            records[name]={"sha256":sha,"bytes":len(content)}
    verified_download(SOURCE["license_url"],destination/"GPL-2.0.txt",SOURCE["license_sha256"],100000)
    write_json(work/"glmnet-sources.json",{**SOURCE,"retained_files":records})
    return destination

class GlmnetBuilder(Builder):
    def build(self,source):
        executable=self.bin/"gfortran.exe"
        self.toolchain["gfortran"]={"file":str(executable),"sha256":digest(executable),
                                   "version":self.run([executable,"--version"])}
        directory=self.work/"build/glmnet-2013"
        directory.mkdir(parents=True,exist_ok=True)
        core=directory/"GLMnet.o";abi=directory/"glmnet_abi.o"
        # Fixed source columns 73+ contain upstream sequence counters. Never
        # use -ffixed-line-length-none or -fdefault-real/integer-8.
        self.run([executable,"-O2","-std=legacy","-ffixed-line-length-72","-c",source/"GLMnet.f","-o",core])
        self.run([executable,"-O2","-std=f2008","-c",ROOT/"data-tools/native/glmnet_abi.f90","-o",abi])
        target=directory/"glmnetMex.mex"
        self.toolchain["wrapper_compatibility"]=prepare_wrappers(ROOT,self.work,directory/"compat")
        self.run([self.bin/"mkoctfile.exe","--mex","-O2","-std=gnu++11",
                  ROOT/"data-tools/native/glmnet_legacy_bridge.cpp",core,abi,"-lgfortran","-o",target],directory)
        self.toolchain["interop"]={
            "Fortran":"Unmodified official REAL32/INTEGER32; default kinds checked by compiled bind(C) runtime probe",
            "host_dimensions":"mwSize[2], mwSize/mwIndex 64-bit compile assertions; checked int32 scalar/products before allocation",
            "interface":"Legacy 14/15 inputs and 8 outputs retained; optional trailing path-control struct and ninth budget output",
            "coefficients":"Unbounded limits, zero offset, intercept enabled; original public wrappers retained",
            "gaussian_max_passes":100000,
            "binomial_max_passes":"Legacy maxit numeric argument passed unchanged to newer core; newer core counts passes over the whole path, not old outer iterations. Native jerr/partial-path warnings preserved.",
            "explicit_options":"octave_max_passes overrides the new-core whole-path pass limit; octave_require_complete demands jerr=0 and every requested lambda",
            "fit_metadata":"fit.octave_budget records actual limit, source, passes used, requested/completed lambdas, native jerr",
            "alpha_zero":"Exact official alpha=0, not the bundled 2008 alpha=.001 floor",
            "precision":"Single precision, matching official source and original Fortran MEX conversion",
        }
        return target

    def record(self,binary,status,error=None):
        records=[]
        if binary:
            data=binary.read_bytes();offset=struct.unpack_from("<I",data,0x3c)[0]
            if data[offset:offset+4]!=b"PE\0\0" or struct.unpack_from("<H",data,offset+4)[0]!=0x8664:
                raise ValueError("Provider is not an AMD64 PE binary")
            records=[{"file":str(binary),"sha256":digest(binary),"bytes":len(data),"machine":"AMD64"}]
        document={"family":"glmnet","source":SOURCE,"source_manifest":str(self.work/"glmnet-sources.json"),
                  "status":status,"runtime_execution_verified":False,"binaries":records,"toolchain":self.toolchain,
                  "gateway_sources":{name:digest(ROOT/"data-tools/native"/name) for name in
                                     ("glmnet_legacy_bridge.cpp","glmnet_abi.f90","glmnet_options.py")},
                  "commands":self.commands,"error":error}
        previous=self.output/"glmnet-build.json"
        if previous.exists():
            saved=previous.with_name("glmnet-build.previous-"+digest(previous)[:12]+".json")
            if not saved.exists():shutil.copyfile(previous,saved)
            document["previous_build_manifest"]=str(saved)
        write_json(self.output/"glmnet-build.json",document)
        return document

def activate_glmnet(work,output,replace_owned=False):
    document=json.loads((output/"glmnet-build.json").read_text())
    if document["status"]!="built_not_loaded" or document["source"]!=SOURCE:
        raise ValueError("Only the reviewed successful build can be activated")
    if len(document["binaries"])!=1 or Path(document["binaries"][0]["file"]).name!="glmnetMex.mex":
        raise ValueError("Expected exactly the reviewed GLMnet MEX entry")
    destination=ROOT/"pmtksupportCopy/packages/glmnet-matlab"
    wrappers=document["toolchain"].get("wrapper_compatibility",[])
    for wrapper in wrappers:
        target=destination/wrapper["name"]
        if digest(Path(wrapper["file"]))!=wrapper["patched_sha256"]:raise ValueError("Derived wrapper checksum mismatch")
        if digest(target) not in {wrapper["original_sha256"],wrapper["patched_sha256"]}:
            raise ValueError(f"Refusing to overwrite an unreviewed wrapper: {target}")
    for binary in document["binaries"]:
        source=Path(binary["file"]);target=destination/source.name
        if digest(source)!=binary["sha256"]: raise ValueError("Build checksum mismatch")
        if target.exists() and digest(target)!=digest(source):
            previous=json.loads((destination/"glmnet-native-provider.json").read_text())
            expected=[b["sha256"] for b in previous.get("binaries",[]) if Path(b["file"]).name==target.name]
            if not replace_owned or previous.get("source")!=SOURCE or expected!=[digest(target)]:
                raise ValueError("Refusing to replace anything other than an explicitly selected, hash-verified owned provider")
            archive=work/"installed-history/glmnet"/digest(target)
            archive.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(target,archive/target.name)
            shutil.copyfile(destination/"glmnet-native-provider.json",archive/"provider.json")
            temporary=target.with_suffix(".mex.pending");shutil.copyfile(source,temporary);temporary.replace(target)
        elif not target.exists(): shutil.copyfile(source,target)
    for wrapper in wrappers:
        shutil.copyfile(Path(wrapper["file"]),destination/wrapper["name"])
    shutil.copyfile(work/"sources/glmnet-2013/GPL-2.0.txt",destination/"glmnet-native-GPL-2.0.txt")
    write_json(destination/"glmnet-native-provider.json",document)
    print("Activated glmnetMex.mex beside its documentation stub; other-platform MATLAB binaries unchanged.")

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase",choices=("fetch","build","activate"),required=True)
    parser.add_argument("--octave-bin",type=Path)
    parser.add_argument("--replace-owned",action="store_true",help="Replace only a matching hash-verified prior native provider; never MATLAB platform binaries")
    parser.add_argument("--output",type=Path,default=ROOT/"demo-results-integration/native-continuation")
    args=parser.parse_args();output=args.output.resolve();work=ROOT/".demo-runtime/native-providers"
    forbidden=(ROOT/"demo-results").resolve()
    if output==forbidden or forbidden in output.parents: raise ValueError("Do not use main demo-results")
    if args.phase=="activate":activate_glmnet(work,output,args.replace_owned);return
    source=materialize_glmnet(work)
    if args.phase=="fetch":return
    if args.octave_bin is None:parser.error("--octave-bin is required for build")
    builder=GlmnetBuilder(args.octave_bin,work,output,1)
    try:
        builder.audit_toolchain();binary=builder.build(source);builder.record(binary,"built_not_loaded")
        print("Official genuine GLMnet built, not activated or loaded.")
    except Exception as error:
        builder.record(None,"build_failed",str(error));raise

if __name__=="__main__":main()
