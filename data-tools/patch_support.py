"""Install recorded native-optional support without discarding local edits."""

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PATCHES = (
    ("minfunc-optional-mex.patch", ("markSchmidt-9march2011", "markSchmidt", "minFunc", "minFunc_processInputOptions.m"),
     "Default to the existing pure-code optimizer when optional MEX files are absent; explicit USEMEX is preserved."),
    ("l1general-optional-mex.patch", ("markSchmidt-9march2011", "markSchmidt", "L1General", "L1GeneralProjection.m"),
     "Use the existing L-BFGS recursion when its optional native extension is absent."),
    ("netlab-callables.patch", ("netlab3.3", "scg.m"),
     "Preserve Netlab callable/name/expression objectives across optimizers and samplers; MATLAB retains native fcnchk."),
    ("ugm-octave-defaults.patch", ("markSchmidt-9march2011", "markSchmidt", "UGM", "misc", "UGM_makeEdgeStruct.m"),
     "Default direct UGM constructors and synthetic generation to existing pure code on Octave; MATLAB defaults and explicit native requests are preserved."),
    ("graphviz-abstract-method.patch", ("graphViz4Matlab", "layouts", "Abstractlayout.m"),
     "Use a portable function/end abstract method declaration without changing graph layout behavior."),
    ("glmnet-errorbar-properties.patch", ("glmnet-matlab", "cvglmnetPlot.m"),
     "Set CV error-bar graphics properties separately from data/format arguments; predictions and errors remain unchanged."),
)

COMPATIBILITY_SOURCES = (
    ("max_mult.m", ("markSchmidt-9march2011", "markSchmidt", "KPM", "max_mult.m"),
     "Equivalent bounded-memory max-times matrix multiplication; same-directory native extensions retain priority."),
    ("projectRandom2C.m", ("markSchmidt-9march2011", "markSchmidt", "L1GeneralGroup", "mex", "projectRandom2C.m"),
     "Nonnegative L1-ball native-name compatibility entry delegates to the existing authentic tie-aware projectRandom2; recognized same-directory MEX retains priority."),
    ("UGM_MFGibbsFreeEnergy.m", ("markSchmidt-9march2011", "markSchmidt", "UGM", "sub", "UGM_MFGibbsFreeEnergy.m"),
     "Restore the original seven-argument UGM 2011 mean-field Gibbs free energy; only the declared function name, license header and line endings are changed."),
)
RECOVERY_PROVENANCE = {
    "UGM_MFGibbsFreeEnergy.m": {
        "source_url": "https://www.cs.ubc.ca/~schmidtm/Software/UGM_2011.zip",
        "archive_sha256": "328299d1c5239e122de118684b5592f56ba05b33c977a3ac98b4a0c29a0e1e9f",
        "archive_member": "UGM/sub/UGM_MFGibbsFreeEnergy.m",
        "original_member_sha256": "948c786b20393263cf3c2047da88e2962e07c12c3200bfa27251b85eba3aaa5f",
        "license_url": "https://www.cs.ubc.ca/~schmidtm/Software/copyright.html",
        "license": "Mark Schmidt FreeBSD-style",
    },
    "projectRandom2C.m": {
        "implementation_source": "markSchmidt-9march2011/markSchmidt/L1GeneralGroup/projectRandom2.m",
        "source_repository": "https://github.com/probml/pmtksupport",
        "source_url": "https://www.cs.ubc.ca/~schmidtm/Software/PQN.html",
    },
}


def main(manifest: Path | None = None) -> None:
    support = ROOT / "pmtksupportCopy" / "packages"
    command = [
        "git", "-C", str(support),
        "-c", "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol",
        "apply", "--ignore-space-change",
    ]
    planned = []
    unapplied = []
    for filename, parts, behavior in PATCHES:
        patch = ROOT / "data-tools" / filename
        source = support.joinpath(*parts)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        check = subprocess.run([*command, "--check", str(patch)], capture_output=True, text=True)
        if check.returncode == 0:
            unapplied.append(str(patch))
        else:
            reverse = subprocess.run(
                [*command, "--reverse", "--check", str(patch)], capture_output=True, text=True
            )
            if reverse.returncode != 0:
                raise RuntimeError(
                    f"Support patch conflicts with local source; no edits were discarded:\n{check.stderr}"
                )
        planned.append((patch, source, before, behavior))
    additions = []
    for filename, parts, behavior in COMPATIBILITY_SOURCES:
        template = ROOT / "data-tools" / "compatibility" / filename
        destination = support.joinpath(*parts)
        content = template.read_bytes()
        if destination.exists() and destination.read_bytes() != content:
            raise RuntimeError(f"Refusing to overwrite modified compatibility source: {destination}")
        provenance = dict(RECOVERY_PROVENANCE.get(filename, {}))
        if "implementation_source" in provenance:
            delegate = support / provenance["implementation_source"]
            if not delegate.is_file():
                raise RuntimeError(f"Existing pure projection implementation is missing: {delegate}")
            provenance["implementation_sha256"] = hashlib.sha256(delegate.read_bytes()).hexdigest()
        additions.append((template, destination, content, behavior, provenance))
    if unapplied:
        subprocess.run([*command, *unapplied], check=True)
    for _, destination, content, _, _ in additions:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            destination.write_bytes(content)
    revision = subprocess.check_output(
        ["git", "-C", str(support), "rev-parse", "HEAD"], text=True
    ).strip()
    output = manifest if manifest is not None else ROOT / "demo-results" / "support-patches.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    records = json.loads(output.read_text(encoding="utf-8")) if output.exists() else []
    for patch, source, before, behavior in planned:
        after = hashlib.sha256(source.read_bytes()).hexdigest()
        if not any(record["patched_sha256"] == after for record in records):
            records.append({
                "kind": "upstream_compatibility_patch",
                "source_repository": "https://github.com/probml/pmtksupport",
                "source_commit": revision,
                "file": source.relative_to(ROOT).as_posix(),
                "patch": patch.relative_to(ROOT).as_posix(),
                "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
                "previous_sha256": before,
                "patched_sha256": after,
                "behavior": behavior,
                "patched_files": [
                    {
                        "file": support.joinpath(*line[6:].split("/")).relative_to(ROOT).as_posix(),
                        "sha256": hashlib.sha256(
                            support.joinpath(*line[6:].split("/")).read_bytes()
                        ).hexdigest(),
                    }
                    for line in patch.read_text(encoding="utf-8").splitlines()
                    if line.startswith("+++ b/")
                ],
            })
    for template, destination, content, behavior, provenance in additions:
        installed_hash = hashlib.sha256(content).hexdigest()
        if not any(record["patched_sha256"] == installed_hash for record in records):
            if "implementation_source" in provenance:
                provenance["source_commit"] = revision
            records.append({
                "kind": "upstream_recovered_source" if "archive_member" in provenance else "local_compatibility_source",
                "file": destination.relative_to(ROOT).as_posix(),
                "template": template.relative_to(ROOT).as_posix(),
                "patched_sha256": installed_hash,
                "behavior": behavior,
                **provenance,
            })
    output.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"Verified {len(PATCHES)} support patches and {len(COMPATIBILITY_SOURCES)} compatibility sources; provenance: {output}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, help="Override the provenance output (default: demo-results/support-patches.json)")
    main(parser.parse_args().manifest)
