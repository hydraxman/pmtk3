"""Checked, version-specific integer interchange edits to a derived libDAI tree."""
from pathlib import Path
import hashlib
import shutil

HERE = Path(__file__).resolve().parent
OLD_EXPORT = """inline size_t BigInt_size_t( const BigInt &N ) {
    DAI_ASSERT( N <= (BigInt)std::numeric_limits<size_t>::max() );
    return N.get_ui();
}"""
EDITS = {
    "include/dai/clustergraph.h": [
        ("(BigInt)maxStates", "size_t_BigInt(maxStates)", 1)],
    "include/dai/factor.h": [
        ("(BigInt)x.size()", "size_t_BigInt(x.size())", 1),
        ("(BigInt)_p.size()", "size_t_BigInt(_p.size())", 1),
        ("nrStates *= vars[i].states();", "nrStates *= size_t_BigInt(vars[i].states());", 1),
        ("nrStates == p.size()", "nrStates == size_t_BigInt(p.size())", 1)],
    "include/dai/index.h": [
        ("(BigInt)v->states()", "size_t_BigInt(v->states())", 3),
        ("(BigInt)entry->second", "size_t_BigInt(entry->second)", 1)],
    "include/dai/varset.h": [
        ("(BigInt)n->states()", "size_t_BigInt(n->states())", 1)],
    "src/emalg.cpp": [
        ("(BigInt)_estimation->probSize()", "size_t_BigInt(_estimation->probSize())", 1)],
    "src/factor.cpp": [
        ("(BigInt)state", "size_t_BigInt(state)", 1)],
    "src/jtree.cpp": [
        ("(BigInt)sizeof(Real)", "size_t_BigInt(sizeof(Real))", 1),
        ("(BigInt)fudge", "size_t_BigInt(fudge)", 1),
        ("(BigInt)props.maxmem", "size_t_BigInt(props.maxmem)", 1)],
}


def prepare(source: Path, destination: Path) -> list[dict]:
    # Pristine pinned source is retained separately; never edit it in place.
    source=source.resolve()
    destination=destination.resolve()
    if source==destination or source in destination.parents or destination in source.parents:
        raise ValueError("Pristine and derived source trees must not overlap")
    shutil.copytree(source, destination, dirs_exist_ok=True)
    edits = dict(EDITS)
    functions = (HERE / "libdai_size_t_functions.h").read_text(encoding="utf-8").rstrip()
    edits["include/dai/util.h"] = [
        (OLD_EXPORT, functions, 1),
        ("#include <cerrno>", "#include <cerrno>\n#include <limits>", 1),
    ]
    records = []
    for relative, replacements in edits.items():
        original = source / relative
        text = original.read_text(encoding="utf-8")
        for old, new, expected in replacements:
            if text.count(old) != expected:
                raise RuntimeError(f"Pinned full-width repair mismatch: {relative}: {old}")
            text = text.replace(old, new)
        target = destination / relative
        target.write_text(text, encoding="utf-8")
        records.append({
            "file": relative,
            "upstream_sha256": hashlib.sha256(original.read_bytes()).hexdigest(),
            "derived_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "replacements": replacements,
        })
    return records
