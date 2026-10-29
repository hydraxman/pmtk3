"""Source inventory; no MATLAB/Octave execution and no third-party imports."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

SCHEMA_VERSION = 1
RETRY_STATUSES = {"failed", "timeout", "resource_limit", "runner_error", "interrupted"}
TERMINAL_STATUSES = RETRY_STATUSES | {"success", "blocked", "unsupported", "helper", "source_missing"}

# Explicit, evidence-backed historical names only. Do not infer aliases from
# similar spellings: kernelRegrDemo was renamed to svmRegrDemo, NOT to the
# algorithmically different kernelRegressionDemo.
HISTORICAL_ALIASES = {
    "huberlossdemo": {
        "published_stem": "huberLossDemo",
        "old_source": "demos/huberLossDemo.m",
        "source": "demos/huberLossPlot.m",
        "commit": "302750aa3ad5c2ec1c5270502a4f0e453ddaaff7",
        "date": "2019-09-09",
        "change": "R100",
        "reason": "Verified exact rename in repository history",
    },
    "kernelregrdemo": {
        "published_stem": "kernelRegrDemo",
        "old_source": "demos/kernelRegrDemo.m",
        "source": "demos/svmRegrDemo.m",
        "commit": "302750aa3ad5c2ec1c5270502a4f0e453ddaaff7",
        "date": "2019-09-09",
        "change": "R100",
        "reason": "Verified exact rename with full demos-path rename detection; not kernelRegressionDemo",
    },
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def within(path: Path, roots: tuple[Path, ...]) -> bool:
    resolved = path.resolve()
    return any(resolved.is_relative_to(root.resolve()) for root in roots)


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix="." + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        # A concurrent web reader on Windows can briefly withhold delete sharing.
        # Keep the previous complete snapshot visible and retry only sharing errors.
        for attempt in range(10):
            try:
                os.replace(temp, path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(min(.02 * 2 ** attempt, .2))
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def write_json(path: Path, data: object) -> None:
    atomic_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as stream:
        data = json.load(stream)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return data


def matlab_code(text: str) -> str:
    """Conservative lexer: remove comments/strings but retain line positions.

    A quote after an expression is a transpose, not a string delimiter.
    This is a static triage tool, NOT a MATLAB parser or a security sandbox.
    """
    out = []
    block = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("%{"):
            block = True
        if block:
            out.append("")
            if stripped.startswith("%}"):
                block = False
            continue
        result = []
        i = 0
        while i < len(line):
            char = line[i]
            if char == "%":
                break
            previous = next((x for x in reversed(result) if not x.isspace()), "")
            if char == '"' or (char == "'" and (not previous or previous in "=([{,;:+-*/~<>|&")):
                quote = char
                result.append(" ")
                i += 1
                while i < len(line):
                    if line[i] == quote:
                        if i + 1 < len(line) and line[i + 1] == quote:
                            i += 2
                            continue
                        break
                    i += 1
            else:
                result.append(char)
            i += 1
        out.append("".join(result))
    return "\n".join(out)


def safety_findings(text: str) -> list[dict]:
    code = matlab_code(text)
    findings = []
    # Separate known local graphics/temp cleanup and constrained renderer calls
    # from disk/global actions. Unknown dynamic OS commands remain blocking.
    danger = re.compile(
        r"(?<![\w.])(?:exit|quit|system|unix|dos|rmdir|delete|movefile|copyfile|"
        r"cd|chdir|initPmtk3(?:Octave)?|restoredefaultpath|downloadAllSupport|"
        r"urlwrite|urlread|webread|websave|webwrite|javaMethod|perl|python)\b"
        r"(?!\s*=)(?=\s*(?:\(|;|$|\s+[^\s=]))", re.I
    )
    for line_no, line in enumerate(code.splitlines(), 1):
        for match in danger.finditer(line):
            operation = match.group().strip()
            finding = {"line": line_no, "operation": operation, "blocking": True,
                       "reason": "process/OS/write/path/network operation requires review"}
            original_line = text.splitlines()[line_no - 1]
            if operation.lower() in {"system", "unix", "dos"}:
                # Only a single literal known renderer command is a warning;
                # runtime still validates the command and confines its output.
                literal = re.search(r"\b(?:system|unix|dos)\s*\(\s*'((?:[^']|'')*)'", original_line, re.I)
                if literal:
                    command = literal[1].replace("''", "'").strip()
                    if re.match(r'^"?(?:[^"\s]*[/\\])?(?:dot|neato|fdp|sfdp|twopi|circo|gnuplot)(?:\.exe)?"?(?:\s|$)',
                                command, re.I) and not re.search(r"[;&|`$%^!\r\n]", command):
                        finding.update(blocking=False, reason="external graph renderer; runtime command/path checks apply")
            elif operation.lower() == "delete":
                argument = re.search(r"\bdelete\s*\(\s*(\w+)\s*\)", line)
                if argument:
                    assignments = list(re.finditer(r"(?m)^\s*" + re.escape(argument[1]) + r"\s*=\s*(.*)",
                                                   "\n".join(code.splitlines()[:line_no - 1])))
                    value = assignments[-1][1] if assignments else ""
                    if re.match(r"(?:uicontrol|figure|gobjects|axes)\s*\(", value):
                        finding.update(blocking=False, reason="deletes a locally created graphics handle")
                    elif re.match(r"fullfile\s*\(\s*tempdir\s*\(", value):
                        finding.update(blocking=False, reason="temporary file cleanup; child tempdir is attempt-local")
            findings.append(finding)
        if re.search(r"(?:^|[;,])\s*!", line):
            findings.append({"line": line_no, "operation": "!",
                             "reason": "shell escape requires review"})
    # eval of literal dangerous commands must not evade the direct-code scan.
    for line_no, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("%"):
            continue
        if re.search(r"\b(?:eval|evalin|feval|builtin)\s*\([^%\n]*(?:['\"])(?:exit|quit|system|"
                     r"unix|dos|rmdir|delete|cd)\b", line, re.I):
            findings.append({"line": line_no, "operation": "dynamic-dangerous-call",
                             "reason": "literal dynamic process/OS command"})
    return findings


def description(text: str, stem: str) -> str:
    for line in text.splitlines():
        match = re.match(r"\s*%+\s*(.*?)\s*$", line)
        if not match:
            continue
        value = match[1]
        if not value or re.match(r"(?:PMTK|This file is from|Copyright|License|Author|https?://|"
                                r"Code from|Modified by|#)", value, re.I):
            continue
        value = re.sub(r"<[^>]*>", "", value).strip()
        if value and not re.fullmatch(r"[-%=*\s]+", value):
            return value[:280]
    return f"{stem}: no descriptive source comment found."


def octave_constraints(text: str) -> list[dict]:
    """Recognize only a leading positive isOctave guard which logs and returns.

    An Octave alternative implementation, a later return after work, negative
    guards, nested conditions, and ordinary nonvisual math are NOT skipped.
    """
    code = matlab_code(text)
    header = re.match(r"\A\s*function[^\n]*(?:\n|$)", code)
    offset = header.end() if header else 0
    guard = re.match(
        r"\A\s*(?P<condition>if[ \t]+\(?[ \t]*isOctave[ \t]*(?:\([ \t]*\))?[ \t]*\)?"
        r"[ \t]*(?:[,;]?[ \t]*\r?\n|[,;]))(?P<body>.*?)\bend\b", code[offset:], re.S)
    if not guard:
        return []
    true_branch = re.split(r"\b(?:else|elseif)\b", guard["body"], maxsplit=1)[0]
    statements = [s.strip() for s in re.split(r"[;\r\n]+", true_branch) if s.strip()]
    if "return" not in statements or any(
        statement != "return" and not re.fullmatch(r"(?:fprintf|disp|warning)\s*\(.*\)", statement)
        for statement in statements
    ):
        return []
    requirement = "MATLAB memmapfile" if re.search(r"\bmemmapfile\s*\(", code) else "MATLAB-only implementation"
    return [{"engine": "octave", "status": "unsupported", "requirement": requirement,
             "line": code[:offset + guard.start("condition")].count("\n") + 1,
             "reason": f"Requires {requirement}; the leading isOctave() guard returns before the demo workload."}]


def unsupported_constraint(entry: dict) -> dict | None:
    return next((c for c in entry.get("engine_constraints", [])
                 if c["engine"] == "octave" and c["status"] == "unsupported"), None)


def source_metadata(path: Path, repo: Path) -> dict:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    code = matlab_code(text)
    first = next((line.strip() for line in code.splitlines() if line.strip()), "")
    signature = None
    if first.startswith("function"):
        signature = re.search(
            r"^function\s+(?:(?:\[[^\]]*\]|\w+)\s*=\s*)?(\w+)\s*(?:\(([^)]*)\))?", first
        )
    args = [v.strip() for v in (signature[2] or "").split(",") if v.strip()] if signature else []
    # Only explicit zero-input guards are accepted; unknown functions are helpers.
    main_code = re.split(r"(?m)^\s*function\b", code, maxsplit=2)[1] if signature else code
    optional_zero = bool(args) and bool(re.search(
        r"\bnargin\s*(?:<\s*1|==\s*0|<=\s*0)(?![\d.])", main_code))
    requires_args = bool(args) and not optional_zero
    nested = path.parent != repo / "demos"
    # Statistical hypothesis-test demos are not legacy unit/regression tests.
    legacy = path.stem.casefold().endswith("test") or (nested and path.stem.casefold().startswith("test"))
    if requires_args or nested:
        kind = "legacy_test" if legacy else "helper"
        runnable = False
    else:
        kind = "legacy_test" if legacy else "demo"
        runnable = True
    findings = safety_findings(text)
    tags = [{"name": m[1], "value": m[2].strip()} for m in
            re.finditer(r"(?m)^[ \t]*%+[ \t]*PMTK(\w+)[ \t]*([^\r\n]*)", text)]
    return {
        "id": path.relative_to(repo / "demos").with_suffix("").as_posix(),
        "name": path.stem, "source": path.relative_to(repo).as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "description": description(text, path.stem), "kind": kind,
        "entry_type": "function" if signature else "script",
        "declared_function": signature[1] if signature else None,
        "arguments": args, "requires_args": requires_args,
        "optional_zero_args": optional_zero, "runnable": runnable,
        "engine_constraints": octave_constraints(text),
        "safety": [f for f in findings if f.get("blocking", True)],
        "warnings": [f for f in findings if not f.get("blocking", True)],
        "needs_libsvm": bool(re.search(r"\b(?:libsvm|svm\w*)\b", code, re.I)),
        "tags": tags, "chapters": [], "published": [], "historical_aliases": [],
        "interactive": bool(re.search(r"\b(?:pause|input|keyboard|uiwait)\b", code)),
        "called_names": sorted(set(re.findall(r"(?<![\w.])([A-Za-z]\w*)\s*\(", code))),
    }


class ImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag.lower() == "img":
            src = dict(attrs).get("src")
            if src:
                self.images.append(src)


def historical_images(page: Path, repo: Path) -> list[str]:
    parser = ImageParser()
    parser.feed(page.read_text(encoding="utf-8", errors="replace"))
    images = []
    for value in parser.images:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or "\\" in value:
            continue
        image = page.parent / unquote(parsed.path)
        if (within(image, (repo,)) and image.is_file()
                and image.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}):
            relative = image.resolve().relative_to(repo.resolve()).as_posix()
            if relative not in images:
                images.append(relative)
    return images


def result_directory(output: Path, entry: dict) -> Path:
    # IDs may contain nested source paths; result folders are collision-resistant
    # flat names, and never permit source/manifest path traversal.
    slug = re.sub(r"[^A-Za-z0-9_.-]", "_", entry["name"])[:90]
    digest = hashlib.sha256(entry["id"].encode()).hexdigest()[:12]
    return output / "demos" / f"{slug}-{digest}"


def default_status(entry: dict) -> str:
    if entry["source"] is None:
        return "source_missing"
    if not entry["runnable"]:
        return "helper"
    if unsupported_constraint(entry):
        return "unsupported"
    if entry["safety"]:
        return "blocked"
    return "pending"


def current_result(entry: dict, output: Path) -> dict:
    path = result_directory(output, entry) / "result.json"
    base = {"status": default_status(entry), "success": False, "figures": []}
    constraint = unsupported_constraint(entry) if base["status"] == "unsupported" else None
    if constraint:
        base.update(id=entry["id"], source=entry["source"], source_sha256=entry["sha256"],
                    engine="octave", message=constraint["reason"], requirement=constraint["requirement"],
                    workload_executed=False, execution_disposition="not_executed",
                    classification_only=True, classification_basis=constraint)
    if not path.exists():
        return base
    try:
        result = read_json(path)
        if result.get("id") != entry["id"]:
            raise ValueError("Result identity mismatch")
        status = result.get("status")
        if status not in TERMINAL_STATUSES | {"running"}:
            raise ValueError(f"Unknown result status: {status!r}")
        if type(result.get("success")) is not bool or result["success"] != (status == "success"):
            raise ValueError("Result status disagrees with actual success bool")
        reported_success = result["success"]
        if (not isinstance(result.get("figures", []), list)
                or not all(isinstance(p, str) for p in result.get("figures", []))):
            raise ValueError("Result figures must be a list of artifact paths")
        if status == "running" and result.get("runner_pid") != os.getpid():
            result = dict(result, status="interrupted", success=False,
                          message="Previous runner stopped before finalizing this attempt.")
        if entry["source"] and result.get("source_sha256") != entry["sha256"]:
            result = dict(result, status="stale", success=False,
                          message="Source changed since this attempt; previous artifacts are historical.")
        if base["status"] in {"helper", "blocked", "unsupported", "source_missing"}:
            if constraint:
                # Preserve raw attempt history, but an exit-zero early return
                # must never remain a current execution success.
                if status != "unsupported":
                    result.setdefault("superseded_report", {
                        "status": status, "success": reported_success,
                        "reason": "Reclassified: source has an Octave no-work return guard."})
                result.update(message=constraint["reason"], requirement=constraint["requirement"],
                              workload_executed=False, execution_disposition="not_executed",
                              classification_basis=constraint)
            result = dict(result, status=base["status"], success=False)
        return result
    except (ValueError, OSError) as exc:
        if constraint:
            return dict(base, previous_result_error=f"Cannot read old result: {exc}")
        return dict(base, status="runner_error", message=f"Cannot read result: {exc}")


def build_inventory(repo: Path, output: Path) -> dict:
    repo = repo.resolve()
    entries = [source_metadata(p, repo) for p in sorted((repo / "demos").rglob("*.m"))
               if within(p, (repo,))]
    by_stem: dict[str, list[dict]] = {}
    by_source = {entry["source"].casefold(): entry for entry in entries}
    for entry in entries:
        by_stem.setdefault(entry["name"].casefold(), []).append(entry)
    # Follow concrete calls between original demo sources. This catches, for
    # example, pagerankDemoMoler -> surfer (network/GUI/delete operations).
    # Dynamic calls and the entire external toolbox are intentionally not
    # claimed to be proven safe; runtime OS/exit guards provide another layer.
    while True:
        dangerous = {e["name"].casefold() for e in entries if e["safety"]}
        added = False
        for entry in entries:
            if entry["safety"]:
                continue
            calls = sorted({c for c in entry["called_names"] if c.casefold() in dangerous})
            if calls:
                entry["safety"].append({"line": 0, "operation": ", ".join(calls),
                                        "reason": "calls another source blocked by static safety triage"})
                added = True
        if not added:
            break
    pages = sorted((repo / "docs" / "demoOutput" / "bookDemos").rglob("*.html"))
    chapters: dict[str, dict] = {}
    missing: dict[str, dict] = {}
    counts = {"m_files": len(entries),
              "top_level_m_files": sum("/" not in e["id"] for e in entries),
              "nested_m_files": sum("/" in e["id"] for e in entries),
              "helpers": sum(not e["runnable"] for e in entries),
              "helpers_requiring_args": sum(e["requires_args"] for e in entries),
              "legacy_tests": sum(e["kind"] == "legacy_test" for e in entries),
              "unique_demos": sum(e["kind"] == "demo" and e["runnable"] for e in entries),
              "runnable_legacy_tests": sum(e["kind"] == "legacy_test" and e["runnable"] for e in entries),
              "runnable_candidates": sum(e["runnable"] for e in entries),
              "blocked_candidates": sum(default_status(e) == "blocked" for e in entries),
              "unsupported_candidates": sum(default_status(e) == "unsupported" for e in entries),
              "html_pages": len(pages), "chapter_index_pages": 0,
              "published_demo_pages": 0, "source_matched_pages": 0,
              "ambiguous_source_pages": 0, "historical_alias_pages": 0}
    demo_stems = set()
    alias_stems = set()
    for page in pages:
        if not within(page, (repo,)):
            continue
        chapter = page.parent.relative_to(repo / "docs" / "demoOutput" / "bookDemos").as_posix()
        chapter_info = chapters.setdefault(chapter, {"id": chapter, "title": chapter.replace("_", " "),
                                                     "pages": 0, "demo_pages": 0})
        chapter_info["pages"] += 1
        if page.stem.casefold() == "index":
            counts["chapter_index_pages"] += 1
            continue
        counts["published_demo_pages"] += 1
        chapter_info["demo_pages"] += 1
        demo_stems.add(page.stem.casefold())
        matches = by_stem.get(page.stem.casefold(), [])
        alias = None
        # A current exact-name source always wins. Apply an explicit rename
        # only when its verified target is actually present in this checkout.
        if not matches:
            candidate = HISTORICAL_ALIASES.get(page.stem.casefold())
            target = by_source.get(candidate["source"].casefold()) if candidate else None
            if target:
                alias = dict(candidate)
                matches = [target]
                counts["historical_alias_pages"] += 1
                alias_stems.add(page.stem.casefold())
                if alias not in target["historical_aliases"]:
                    target["historical_aliases"].append(alias)
        if len(matches) > 1:
            counts["ambiguous_source_pages"] += 1
        if matches:
            counts["source_matched_pages"] += 1
        else:
            matches = [missing.setdefault(page.stem.casefold(), {
                "id": "published/" + page.stem, "name": page.stem, "source": None,
                "sha256": None, "description": "Historical published demo; original source is missing.",
                "kind": "source_missing", "entry_type": None, "declared_function": None,
                "arguments": [], "requires_args": False, "optional_zero_args": False,
                "runnable": False, "safety": [], "tags": [], "chapters": [],
                "published": [], "interactive": False, "historical_aliases": [],
            })]
        for entry in matches:
            if chapter not in entry["chapters"]:
                entry["chapters"].append(chapter)
            entry["published"].append({"page": page.relative_to(repo).as_posix(),
                                       "chapter": chapter, "images": historical_images(page, repo),
                                       "ambiguous_source": len(matches) > 1,
                                       "published_stem": page.stem,
                                       "source_resolution": ("historical_alias" if alias else
                                                             "exact_stem" if entry["source"] else "source_missing"),
                                       "historical_alias": alias})
    counts.update(
        raw_unique_html_stems=len({p.stem.casefold() for p in pages}),
        raw_html_stem_duplicates=len(pages) - len({p.stem.casefold() for p in pages}),
        unique_published_demo_stems=len(demo_stems),
        chapter_demo_page_duplicates=counts["published_demo_pages"] - len(demo_stems),
        source_missing_unique=len(missing),
        source_matched_unique=len(demo_stems - set(missing)),
        historical_alias_unique=len(alias_stems),
        unique_mapped_sources=sum(bool(e["chapters"]) for e in entries),
        canonical_source_page_duplicates=sum(max(0, len(e["published"])-1) for e in entries),
        source_missing_pages=counts["published_demo_pages"] - counts["source_matched_pages"],
        unmapped_sources=sum(not e["chapters"] for e in entries),
        feasible_candidates=sum(default_status(e) == "pending" for e in entries),
        unique_source_stems=len(by_stem),
    )
    entries.extend(missing.values())
    counts["unique_inventory_entries"] = len(entries)
    for entry in entries:
        entry["result"] = current_result(entry, output)
    return {"schema_version": SCHEMA_VERSION, "generated_at": now(),
            "repo": str(repo), "output": str(output.resolve()), "counts": counts,
            "chapters": list(chapters.values()), "entries": entries,
            "historical_aliases": list(HISTORICAL_ALIASES.values())}


def save_inventory(inventory: dict, output: Path) -> None:
    # Called by the coordinator under OutputLock. Unsupported entries cannot
    # have a worker, so safely publish their current classification even when
    # an older latest result incorrectly reported success. Immutable old
    # attempt directories remain untouched for audit.
    for entry in inventory["entries"]:
        if default_status(entry) == "unsupported":
            state = entry["result"]
            state.setdefault("classification_updated_at", now())
            path = result_directory(output, entry) / "result.json"
            try:
                previous = read_json(path) if path.is_file() else None
            except (OSError, ValueError) as exc:
                # Do not destroy corrupt raw evidence; the canonical inventory
                # still exposes unsupported/nonexecuted and the read error.
                state["classification_persist_warning"] = str(exc)
                continue
            if previous != state:
                write_json(path, state)
    write_json(output / "inventory.json", inventory)
    fields = ["id", "name", "source", "kind", "entry_type", "requires_args", "runnable",
              "status", "duration_seconds", "chapters", "description", "tags", "safety", "sha256",
              "historical_aliases", "engine_constraints"]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for entry in inventory["entries"]:
        row = {field: entry.get(field, "") for field in fields}
        row.update(status=entry["result"]["status"],
                   duration_seconds=entry["result"].get("duration_seconds", ""),
                   chapters="; ".join(entry["chapters"]),
                   tags=json.dumps(entry["tags"], ensure_ascii=False),
                   safety=json.dumps(entry["safety"], ensure_ascii=False),
                   historical_aliases=json.dumps(entry.get("historical_aliases", []), ensure_ascii=False),
                   engine_constraints=json.dumps(entry.get("engine_constraints", []), ensure_ascii=False))
        writer.writerow(row)
    atomic_text(output / "inventory.csv", stream.getvalue())
