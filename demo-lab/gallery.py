"""Offline results gallery. Never embeds original HTML or external assets."""
from __future__ import annotations

from collections import Counter
import html
import json
import os
from pathlib import Path
import re
from urllib.parse import quote

from inventory import atomic_text, within


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def local_url(path: Path, output: Path, repo: Path) -> str | None:
    if not within(path, (repo, output)) or not path.is_file():
        return None
    try:
        relative = os.path.relpath(path.resolve(), output.resolve()).replace("\\", "/")
    except ValueError:  # different Windows drive; a local file URI is still contained
        return path.resolve().as_uri()
    return quote(relative, safe="/.")


def link(label: str, path: Path, output: Path, repo: Path) -> str:
    url = local_url(path, output, repo)
    return f'<a href="{escape(url)}">{escape(label)}</a>' if url else escape(label + " (unavailable)")


def chapter_key(value: str) -> tuple:
    match = re.search(r"\((\d+)\)", value)
    return (int(match[1]) if match else 999, value)


def build_gallery(inventory: dict, repo: Path, output: Path) -> Path:
    counts = inventory["counts"]
    entries = inventory["entries"]
    statuses = Counter(e["result"]["status"] for e in entries)
    nav = ['<button type="button" data-chapter="*">All chapters</button>',
           '<button type="button" data-chapter="other/unmapped">Other / unmapped</button>']
    summaries = []
    for chapter in sorted(inventory["chapters"], key=lambda c: chapter_key(c["id"])):
        members = [e for e in entries if chapter["id"] in e["chapters"]]
        current = Counter(e["result"]["status"] for e in members)
        nav.append(f'<button type="button" data-chapter="{escape(chapter["id"])}">'
                   f'{escape(chapter["title"])} ({len(members)})</button>')
        summaries.append(
            f'<li><strong>{escape(chapter["title"])}</strong>: {len(members)} unique entries, '
            f'{chapter["demo_pages"]} published demo pages; '
            f'{current["success"]} current successes. '
            f'Purpose: explore {escape(re.sub(r"^\\(\\d+\\)-", "", chapter["title"]))} '
            'through the source demonstrations listed below.</li>'
        )
    cards = []
    for entry in entries:
        result = entry["result"]
        status = result["status"]
        chapter_names = entry["chapters"] or ["other/unmapped"]
        search = " ".join([entry["name"], entry["description"], entry["kind"],
                           *chapter_names, *[t["name"] + " " + t["value"] for t in entry["tags"]],
                           *[a["published_stem"] for a in entry.get("historical_aliases", [])]])
        alias_notes = "".join(
            f'<p>Historical published name: <code>{escape(a["published_stem"])}</code> → '
            f'<code>{escape(entry["name"])}</code>. Verified {escape(a["change"])} rename, '
            f'{escape(a["date"])}, commit <code>{escape(a["commit"])}</code>. '
            'This is one existing source, not an additional demo.</p>'
            for a in entry.get("historical_aliases", []))
        source = (link("Original .m source", repo / entry["source"], output, repo)
                  if entry["source"] else "Original source missing")
        artifact_links = []
        for key, label in (("log", "Attempt log"), ("attempt_result", "Result JSON"),
                           ("harness_result", "Octave result JSON"), ("metadata", "Runtime/packages"),
                           ("path_origins", "Numerical origins/contracts")):
            if result.get(key):
                artifact_links.append(link(label, output / result[key], output, repo))
        figures = []
        for figure in result.get("figures", []):
            url = local_url(output / figure, output, repo)
            if url:
                partial = status != "success"
                label = "PARTIAL / previous attempt — NOT a current success" if partial else "Current attempt PNG"
                figures.append(f'<figure><a href="{escape(url)}"><img loading="lazy" src="{escape(url)}" '
                               f'alt="{escape(entry["name"])}: {label}"></a>'
                               f'<figcaption>{label}</figcaption></figure>')
        historical = []
        for published in entry["published"]:
            previews = []
            for image in published["images"][:4]:
                url = local_url(repo / image, output, repo)
                if url:
                    previews.append(f'<img loading="lazy" src="{escape(url)}" '
                                    'alt="Historical pre-generated preview; NOT a current result">')
            historical.append(
                '<div class="historical">'
                + link("Historical published HTML — NOT current execution", repo / published["page"], output, repo)
                + f' <span>{escape(published["chapter"])}</span><div class="images">'
                + "".join(previews) + '</div></div>'
            )
        safety = "; ".join(f'line {s["line"]}: {s["operation"]} — {s["reason"]}' for s in entry["safety"])
        warnings = "; ".join(f'line {s["line"]}: {s["operation"]} — {s["reason"]}' for s in entry.get("warnings", []))
        constraints = "; ".join(c["reason"] for c in entry.get("engine_constraints", []))
        tags = ", ".join("PMTK" + t["name"] + (" " + t["value"] if t["value"] else "")
                         for t in entry["tags"])
        duration = result.get("duration_seconds")
        duration_text = f"{duration:.3f}s" if isinstance(duration, (int, float)) else "not measured"
        description = entry["description"]
        message = result.get("message", "")
        if isinstance(result.get("error"), dict):
            message = message or result["error"].get("message", "")
        cards.append(
            f'<article class="card" data-status="{escape(status)}" '
            f'data-chapters="{escape(json.dumps(chapter_names))}" data-search="{escape(search.lower())}">'
            f'<h2>{escape(entry["name"])}</h2><p>{escape(description)}</p>'
            f'<p class="badge">{escape(status)}</p> <span>Duration: {escape(duration_text)}</span>'
            f'<p>{escape(entry["kind"])} · {escape(entry["entry_type"] or "no source")} · '
            f'{escape(", ".join(chapter_names))}</p>'
            f'<p>{source} · ID: <code>{escape(entry["id"])}</code></p>'
            + alias_notes
            + f'<p>Arguments: {escape(", ".join(entry["arguments"]) or "none")} · '
            f'Runnable candidate: {escape(entry["runnable"])}</p>'
            f'<p>{escape(tags)}</p>'
            + (f'<p class="warning">Blocked for review: {escape(safety)}</p>' if safety else "")
            + (f'<p class="warning">Execution notes (not automatic skips): {escape(warnings)}</p>' if warnings else "")
            + (f'<p class="warning">Not executed under Octave: {escape(constraints)}</p>' if constraints else "")
            + ('<p>Interactive calls detected; stdin closed, pauses disabled, timeout enforced.</p>'
               if entry["interactive"] else "")
            + (f'<pre>{escape(message)}</pre>' if message else "")
            + (f'<p class="warning">Figure export warnings: {escape(json.dumps(result["capture_errors"]))}</p>'
               if result.get("capture_errors") else "")
            + '<p>' + " · ".join(artifact_links) + '</p>'
            + (f'<p>Attempt: {escape(result.get("attempt_id", "none"))} · '
               f'{escape(result.get("finished_at") or result.get("started_at", ""))}</p>')
            + '<div class="images">' + "".join(figures) + '</div>'
            + ('<details><summary>Historical references — NOT evidence of a current pass</summary>'
               + "".join(historical) + '</details>' if historical else "")
            + '</article>'
        )
    options = '<option value="*">All statuses</option>' + "".join(
        f'<option value="{escape(s)}">{escape(s)} ({n})</option>' for s, n in sorted(statuses.items()))
    document = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        'img-src \'self\' file:; style-src \'self\' file:; script-src \'self\' file:; base-uri \'none\'">'
        '<title>PMTK3 demo lab</title><link rel="stylesheet" href="gallery.css"></head><body>'
        '<header><h1>PMTK3 original demo lab</h1>'
        '<p>GNU Octave executes original MATLAB sources. Historical references are never counted as passes. '
        'Success means the source returned without a top-level exception and the runner verified its result; '
        'it does not assert numerical correctness. A successful nonvisual demo may have zero figures.</p>'
        f'<p>Updated: {escape(inventory["generated_at"])}</p>'
        '<p>Isolated working directories are not a security sandbox. Static safety triage is conservative, '
        'not a complete analysis of dynamically called toolbox/support code. No network resources are embedded.</p>'
        '<details><summary>Inventory reconciliation / counts</summary><dl>'
        + "".join(f'<dt>{escape(k)}</dt><dd>{v}</dd>' for k, v in counts.items())
        + '</dl><p>Raw HTML counts include chapter index pages. Demo counts exclude indexes. '
        'Chapter associations come only from the existing published HTML directory. '
        'Verified historical aliases attach old published names to existing source entries; '
        'they do not increase source or runnable-candidate counts. '
        'An entry can occur in more than one chapter; chapter totals must not be summed as unique demos.</p>'
        '</details><details><summary>Chapter totals and purposes</summary><ul>'
        + "".join(summaries) + '</ul></details></header>'
        '<section class="controls"><label>Search <input id="search" type="search" placeholder="Name, purpose, tag"></label>'
        f'<label>Status <select id="status">{options}</select></label>'
        '<button type="button" id="reset">Reset</button><p id="visible" aria-live="polite"></p>'
        '<nav aria-label="Chapters">' + "".join(nav) + '</nav></section>'
        '<main>' + "".join(cards) + '</main><script src="gallery.js"></script></body></html>'
    )
    output.mkdir(parents=True, exist_ok=True)
    # Assets are shipped with the lab; copies make an output directory portable offline.
    for filename in ("gallery.css", "gallery.js"):
        atomic_text(output / filename, (Path(__file__).parent / filename).read_text(encoding="utf-8"))
    path = output / "index.html"
    atomic_text(path, document)
    return path
