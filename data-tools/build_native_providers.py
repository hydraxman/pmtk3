"""Pinned local native builds. Never launches Octave or downloaded executables.

Fetch/build are separate from explicit activation so a concurrent demo sweep
cannot discover a partially built provider. No admin/global installations.
"""
from __future__ import annotations

import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "liblinear": {
        "revision": "491c9f1188b97ba70847c70a68be363d186ddf9d",
        "version": "2.50",
        "url": "https://codeload.github.com/cjlin1/liblinear/zip/491c9f1188b97ba70847c70a68be363d186ddf9d",
        "sha256": "6a1b7983ed74c9eb5253373810c09e36e7f8737ddfbdae3686ba24358851f850",
        "archive": "liblinear-491c9f1188b97ba70847c70a68be363d186ddf9d.zip",
        "limit": 4 * 1024**2,
        "license": "BSD-3-Clause", "license_file": "COPYRIGHT",
    },
    "libdai": {
        "revision": "f3ba3ce398b92f9da8c21eb50a7d331d4891da9e",
        "version": "0.3.2",
        "url": "https://bitbucket.org/jorism/libdai/get/f3ba3ce398b92f9da8c21eb50a7d331d4891da9e.tar.gz",
        "sha256": "862a2c2dfb50d56d10bec40be4a437995b2930b445d689cfe2686687eb8ec192",
        "archive": "libdai-f3ba3ce398b92f9da8c21eb50a7d331d4891da9e.tar.gz",
        "limit": 10 * 1024**2,
        "license": "BSD-2-Clause", "license_file": "LICENSE",
    },
    "boost": {
        "revision": "ab7968a0bbcf574a7859240d1d8443f58ed6f6cf",
        "version": "1.85.0",
        "url": "https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2",
        "sha256": "7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617",
        "archive": "boost_1_85_0.tar.bz2",
        "limit": 160 * 1024**2,
        "license": "BSL-1.0", "license_file": "LICENSE_1_0.txt",
    },
}


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def archive_relative(name: str) -> Path:
    normalized = PurePosixPath(name.replace("\\", "/"))
    if normalized.is_absolute() or any(part in ("..", "") or ":" in part for part in normalized.parts):
        raise ValueError(f"Unsafe archive member: {name}")
    if len(normalized.parts) < 2:
        raise ValueError(f"Archive member has no root prefix: {name}")
    return Path(*normalized.parts[1:])


def wanted(family: str, relative: Path) -> bool:
    if family == "boost":
        return relative.parts[0] == "boost" or relative.name == "LICENSE_1_0.txt"
    return (relative.suffix.lower() in {".c", ".cpp", ".h", ".hpp", ".inc", ".m"}
            or relative.name in {"COPYRIGHT", "LICENSE", "README"}
            or relative.name.startswith("Makefile"))


def materialize(family: str, work: Path) -> Path:
    spec = SOURCES[family]
    archive = work / "downloads" / spec["archive"]
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        if digest(archive) != spec["sha256"]:
            raise RuntimeError(f"Cached official archive checksum mismatch: {archive}")
    else:
        temporary = archive.with_suffix(archive.suffix + ".partial")
        count = 0
        try:
            request = urllib.request.Request(spec["url"], headers={"User-Agent": "PMTK-local-native-build/1"})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
                while block := response.read(1024**2):
                    count += len(block)
                    if count > spec["limit"]:
                        raise RuntimeError(f"Official archive exceeds reviewed size limit: {family}")
                    stream.write(block)
            if digest(temporary) != spec["sha256"]:
                raise RuntimeError(f"Official archive checksum mismatch: {family}")
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    destination = work / "sources" / family
    records = {}

    def store(name, stream):
        relative = archive_relative(name)
        if not wanted(family, relative):
            return
        content = stream.read()
        target = destination / relative
        sha = hashlib.sha256(content).hexdigest()
        if target.exists() and digest(target) != sha:
            raise RuntimeError(f"Refusing to overwrite modified source: {target}")
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        records[relative.as_posix()] = {"sha256": sha, "bytes": len(content)}

    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                if entry.is_dir():
                    continue
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError(f"Archive symlink forbidden: {entry.filename}")
                with package.open(entry) as stream:
                    store(entry.filename, stream)
    else:
        with tarfile.open(archive, "r:*") as package:
            for entry in package:
                if entry.isdir():
                    continue
                if not entry.isfile():
                    raise ValueError(f"Archive nonregular member forbidden: {entry.name}")
                with package.extractfile(entry) as stream:
                    store(entry.name, stream)
    if spec["license_file"] not in records:
        raise RuntimeError(f"Required upstream license missing: {family}")
    write_json(work / f"{family}-sources.json", {**spec, "files": records})
    print(f"Verified official {family} {spec['version']}: {len(records)} retained source/license files", flush=True)
    return destination


class Builder:
    def __init__(self, binary_dir: Path, work: Path, output: Path, jobs: int):
        self.bin = binary_dir.resolve()
        self.work = work.resolve()
        self.output = output.resolve()
        self.jobs = jobs
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ.get("PATH", ""))
        self.commands = []
        self.toolchain = {}

    def run(self, command, cwd=None):
        command = [str(x) for x in command]
        result = subprocess.run(command, cwd=cwd, env=self.env, capture_output=True, text=True, errors="replace")
        record = {"command": command, "cwd": str(cwd) if cwd else None,
                  "returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        self.commands.append(record)
        if result.returncode:
            print(result.stdout + result.stderr, flush=True)
            raise RuntimeError(f"Native build command failed ({result.returncode}): {command}")
        return result.stdout.strip()

    def audit_toolchain(self):
        for name in ("mkoctfile.exe", "gcc.exe", "g++.exe"):
            executable = self.bin / name
            if not executable.is_file():
                raise RuntimeError(f"Bundled tool missing: {executable}")
            self.toolchain[name] = {"path": str(executable), "sha256": digest(executable),
                                   "version": self.run([executable, "--version"])}
        if "11.3.0" not in self.toolchain["mkoctfile.exe"]["version"]:
            raise RuntimeError("This audit targets the verified Octave 11.3.0 ABI only")
        target = self.run([self.bin / "gcc.exe", "-dumpmachine"])
        if target != "x86_64-w64-mingw32":
            raise RuntimeError(f"Unreviewed compiler target: {target}")
        self.toolchain["target"] = target
        for variable in ("INCFLAGS", "CXXFLAGS", "CFLAGS", "ALL_LDFLAGS", "OCTLIBDIR"):
            self.toolchain[variable] = self.run([self.bin / "mkoctfile.exe", "-p", variable])
        self.work.mkdir(parents=True, exist_ok=True)
        self.run([self.bin / "mkoctfile.exe", "-c", ROOT / "data-tools" / "native" / "abi_probe.cpp",
                  "-o", self.work / "abi_probe.o"])
        self.toolchain["compile_time_mex_widths"] = {"pointer": 64, "mwSize": 64, "mwIndex": 64, "size_t": 64}

    def objects(self, sources, directory, include_flags=(), defines=()):
        directory.mkdir(parents=True, exist_ok=True)

        def compile_one(source):
            target = directory / (source.stem + ".o")
            compiler = self.bin / ("gcc.exe" if source.suffix == ".c" else "g++.exe")
            flags = [] if source.suffix == ".c" else ["-std=gnu++11"]
            self.run([compiler, "-O2", "-DNDEBUG", *flags, *include_flags, *defines,
                      "-c", source, "-o", target])
            print(f"Compiled {source.name}", flush=True)
            return target

        # Submit only jobs tasks at once: a first compiler error must not
        # continue launching the remaining library's compilation commands.
        results = [None] * len(sources)
        iterator = iter(enumerate(sources))
        with ThreadPoolExecutor(max_workers=self.jobs) as pool:
            pending = {}
            for _ in range(self.jobs):
                item = next(iterator, None)
                if item is not None:
                    index, source = item
                    pending[pool.submit(compile_one, source)] = index
            try:
                while pending:
                    done, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        index = pending.pop(future)
                        results[index] = future.result()
                        item = next(iterator, None)
                        if item is not None:
                            next_index, source = item
                            pending[pool.submit(compile_one, source)] = next_index
            except BaseException:
                for future in pending:
                    future.cancel()
                raise
        return results

    def build_liblinear(self, source: Path):
        directory = self.work / "build" / "liblinear"
        includes = ["-I" + str(source)]
        common = [source / name for name in ("linear.cpp", "newton.cpp")]
        common += [source / "blas" / (name + ".c") for name in ("daxpy", "ddot", "dnrm2", "dscal")]
        objects = self.objects(common, directory, includes)
        self.toolchain["liblinear_mex_audit"] = {
            "sparse_indices": "mwIndex pointers, not int pointers",
            "dimensions": "Scalar mxGetM/N sizes; no legacy int[] dimension pointer passed to mxCreateNumericArray",
            "library_internal_indices": "int32; adapter must bound dimensions, storage and label values",
            "legacy_mwIndex_typedef": "Inactive for the actual Octave 11.3.0 header; successful compilation verifies no typedef conflict",
            "entry_names": ["pmtk_liblinear_train", "pmtk_liblinear_predict"],
        }
        binaries = []
        for verb in ("train", "predict"):
            target = directory / f"pmtk_liblinear_{verb}.mex"
            self.run([self.bin / "mkoctfile.exe", "--mex", "-O2", *includes,
                      source / "matlab" / (verb + ".c"), source / "matlab" / "linear_model_matlab.c",
                      *objects, "-o", target], directory)
            binaries.append(target)
        return binaries

    def build_libdai(self, source: Path, boost: Path):
        directory = self.work / "build" / "libdai"
        directory.mkdir(parents=True, exist_ok=True)
        includes = ["-I" + str(source / "include"), "-I" + str(boost),
                    "-I" + str(self.bin.parent / "include")]
        algorithms = re.findall(r"#ifdef\s+(DAI_WITH_\w+)", (source / "include/dai/alldai.h").read_text())
        # The official dai_config.h already enables these algorithms.
        defines = []
        self.toolchain["libdai_enabled_macros"] = sorted(set(algorithms))
        self.toolchain["libdai_dependency_audit"] = {
            "dimension_arrays": "vector<mwSize>, const mwSize*; SMALLMEM not defined",
            "bundled_gmp_header_sha256": digest(self.bin.parent / "include" / "gmpxx.h"),
            "official_util_header_sha256": digest(source / "include" / "dai" / "util.h"),
            "required_contract": "Exact mpz_class(size_t) and nonnarrowing BigInt_size_t get_ui()",
        }
        self.run([self.bin / "g++.exe", "-std=gnu++11", *includes, "-c",
                  ROOT / "data-tools" / "native" / "libdai_gmp_probe.cpp",
                  "-o", directory / "libdai_gmp_probe.o"])
        cpp = sorted((source / "src").glob("*.cpp"))
        objects = self.objects(cpp, directory, includes, defines)
        transformations = []
        bridge_sources = []
        replacements = {
            "dai.cpp": [("reinterpret_cast<uint32_T *>(mxGetPr(QMAP_OUT))",
                         "static_cast<uint32_T *>(mxGetData(QMAP_OUT))", 1)],
            "matlab.cpp": [
                ("vector<long>", "vector<size_t>", 4),
                ("(long)members[mi]", "(size_t)members[mi]", 2),
                ("long gezocht", "size_t gezocht", 2),
            ],
        }
        for filename, edits in replacements.items():
            original = source / "src" / "matlab" / filename
            text = original.read_text()
            for old, new, count in edits:
                if text.count(old) != count:
                    raise RuntimeError(f"Reviewed ABI transformation no longer matches pinned source: {filename}: {old}")
                text = text.replace(old, new)
            derived = directory / filename
            derived.write_text(text, encoding="utf-8")
            bridge_sources.append(derived)
            transformations.append({"source": str(original), "source_sha256": digest(original),
                                    "derived": str(derived), "derived_sha256": digest(derived),
                                    "edits": edits,
                                    "reason": "Typed uint32 MAP storage and size_t variable labels on Windows LLP64; no inference algorithm changes"})
        self.toolchain["libdai_mex_audit"] = {
            "dimension_arrays": "vector<mwSize> and const mwSize*; SMALLMEM is not defined",
            "compile_time_widths": "64-bit mwSize/mwIndex/size_t assertions passed",
            "bridge_transformations": transformations,
            "dependencies": "Official Boost header-only source and GMP/GMPXX bundled with the verified Octave runtime",
        }
        target = directory / "dai.mex"
        self.run([self.bin / "mkoctfile.exe", "--mex", "-O2", "-std=gnu++11", *includes, *defines,
                  *bridge_sources, *objects,
                  "-L" + str(self.bin.parent / "lib"), "-lgmpxx", "-lgmp", "-o", target], directory)
        return [target]

    def manifest(self, family, binaries, status, error=None):
        files = []
        for path in binaries:
            content = path.read_bytes()
            pe = struct.unpack_from("<I", content, 0x3C)[0]
            machine = struct.unpack_from("<H", content, pe + 4)[0]
            if content[pe:pe+4] != b"PE\0\0" or machine != 0x8664:
                raise RuntimeError(f"Built output is not AMD64 PE: {path}")
            files.append({"file": str(path), "sha256": digest(path), "bytes": len(content), "machine": "AMD64"})
        document = {"family": family, "status": status, "runtime_execution_verified": False,
                    "source": SOURCES[family], "source_manifest": str(self.work / f"{family}-sources.json"),
                    "toolchain": self.toolchain, "binaries": files, "commands": self.commands, "error": error}
        destination = self.output / f"{family}-build.json"
        if destination.exists():
            previous = destination.read_bytes()
            archive = destination.with_name(f"{family}-build.previous-{hashlib.sha256(previous).hexdigest()[:12]}.json")
            if not archive.exists():
                archive.write_bytes(previous)
            document["previous_build_manifest"] = str(archive)
        write_json(destination, document)
        return document


def activate(family, work, output):
    document = json.loads((output / f"{family}-build.json").read_text())
    if document["status"] != "built_not_loaded":
        raise RuntimeError("Cannot activate an unsuccessful build")
    destination = ROOT / "pmtksupportCopy" / "packages" / "nativeProviders" / family
    destination.mkdir(parents=True, exist_ok=True)
    sources = []
    for binary in document["binaries"]:
        source = Path(binary["file"])
        if digest(source) != binary["sha256"]:
            raise RuntimeError(f"Built binary checksum mismatch: {source}")
        sources.append((source, destination / source.name))
    for source, target in sources:
        if target.exists() and digest(target) != digest(source):
            raise RuntimeError(f"Refusing to overwrite active native provider: {target}")
    for source, target in sources:
        if not target.exists():
            shutil.copyfile(source, target)
    for dependency in ([family, "boost"] if family == "libdai" else [family]):
        spec = SOURCES[dependency]
        shutil.copyfile(work / "sources" / dependency / spec["license_file"],
                        destination / (dependency + "-LICENSE.txt"))
    active_manifest = destination / "provider.json"
    if active_manifest.exists():
        existing = json.loads(active_manifest.read_text())
        if existing.get("runtime_execution_verified") and existing.get("binaries") == document["binaries"]:
            document = existing
    write_json(active_manifest, document)
    print(f"Activated genuine {family}: {destination}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", choices=("liblinear", "libdai", "both"), default="both")
    parser.add_argument("--phase", choices=("fetch", "build", "activate"), required=True)
    parser.add_argument("--octave-bin", type=Path)
    parser.add_argument("--jobs", type=int, choices=(1, 2), default=1)
    parser.add_argument("--output", type=Path, default=ROOT / "demo-results-integration" / "native-providers")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == (ROOT / "demo-results").resolve() or (ROOT / "demo-results").resolve() in output.parents:
        raise ValueError("Native experiments must not use main demo-results")
    work = ROOT / ".demo-runtime" / "native-providers"
    families = ("liblinear", "libdai") if args.family == "both" else (args.family,)
    for family in families:
        if args.phase == "activate":
            activate(family, work, output)
            continue
        source = materialize(family, work)
        boost = materialize("boost", work) if family == "libdai" else None
        if args.phase == "fetch":
            continue
        if args.octave_bin is None:
            parser.error("--octave-bin is required for build")
        builder = Builder(args.octave_bin, work, output, args.jobs)
        try:
            builder.audit_toolchain()
            binaries = builder.build_liblinear(source) if family == "liblinear" else builder.build_libdai(source, boost)
            builder.manifest(family, binaries, "built_not_loaded")
            print(f"{family}: built successfully; NOT loaded or activated", flush=True)
        except Exception as error:
            builder.manifest(family, [], "build_failed", str(error))
            raise


if __name__ == "__main__":
    main()
