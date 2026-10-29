import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproductions, runReproduction } from '../shared/reproductions/index.js';
import { renderPlotSvg } from './reproduction-svg.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), repo = path.dirname(root);
const args = process.argv.slice(2);
let seed = 42, requested: string | undefined, requireCoverage = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--all') continue;
  if (args[i] === '--require-coverage') { requireCoverage = true; continue; }
  if (args[i] === '--seed' && args[i + 1] !== undefined) seed = Number(args[++i]);
  else if (args[i] === '--demo' && args[i + 1]) requested = args[++i];
  else throw new Error('Usage: npm run reproduce -- [--all | --demo ID] [--seed UINT32] [--require-coverage]');
}
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer');
const selected = requested ? reproductions.filter(definition => definition.id === requested) : reproductions;
if (!selected.length) throw new RangeError('Unknown visual reproduction ID');
const seedRoot = path.join(root, 'results', 'reproductions', `seed-${seed}`);
const attempt = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const output = path.join(seedRoot, attempt);
await mkdir(output, { recursive: true });
const implementation = createHash('sha256');
for (const name of (await readdir(path.join(root, 'shared', 'reproductions'))).filter(name => name.endsWith('.ts')).sort()) {
  implementation.update(name).update(await readFile(path.join(root, 'shared', 'reproductions', name)));
}
implementation.update(await readFile(path.join(root, 'shared', 'numerics.ts')));
const implementationSha256 = implementation.digest('hex'), generatedAt = new Date().toISOString();
const summaries: { id: string; plots: number; checks: number; durationMs: number }[] = [];
const html = ['<!doctype html><meta charset="utf-8"><title>PMTK independent visual reproductions</title>',
  '<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;color:#24374a}img{width:100%;height:auto}section{border-top:1px solid #ccc;padding:24px 0}code{overflow-wrap:anywhere}li{margin:8px 0}.notice{background:#e8f4f1;padding:20px}</style>',
  '<h1>Independent visual reproductions</h1><p class="notice">These changed educational workloads are not successful executions of the original MATLAB programs. Every chart is freshly computed; original failure records are unchanged.</p>',
  `<p>Seed ${seed} · generated ${generatedAt} · implementation SHA-256 <code>${implementationSha256}</code></p>`];
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
for (const definition of selected) {
  const run = runReproduction(definition.id, seed), folder = path.join(output, run.id);
  await mkdir(folder, { recursive: true });
  const sourceSha256 = createHash('sha256').update(await readFile(path.join(repo, definition.source))).digest('hex');
  await writeFile(path.join(folder, 'result.json'), JSON.stringify({ ...run, generatedAt, implementationSha256, sourceSha256 }, null, 2));
  html.push(`<section id="${run.id}"><h2>${escape(run.id)} — ${escape(run.title)}</h2><p>${escape(run.method)}</p><ul>${run.differences.map(note => `<li>${escape(note)}</li>`).join('')}</ul>`);
  for (const [index, plot] of run.result.plots.entries()) {
    const name = `plot-${String(index + 1).padStart(2, '0')}.svg`;
    await writeFile(path.join(folder, name), renderPlotSvg(plot));
    html.push(`<figure><img src="${run.id}/${name}" alt="${escape(plot.title)}"><figcaption>${escape(plot.title)}</figcaption></figure>`);
  }
  html.push(`<p>${run.result.checks.length} numerical checks passed · <a href="${run.id}/result.json">Numerical data and provenance</a></p></section>`);
  summaries.push({ id: run.id, plots: run.result.plots.length, checks: run.result.checks.length, durationMs: run.durationMs });
}
await writeFile(path.join(output, 'index.html'), html.join('\n'));
let coverage: unknown;
let missingRoutes: string[] | undefined;
try {
  const inventory: { entries: { id: string; runnable: boolean; result: { status: string } }[] } =
    JSON.parse(await readFile(path.join(repo, 'demo-results', 'inventory.json'), 'utf8'));
  const originals = inventory.entries.filter(entry => entry.runnable);
  const covered = new Set(summaries.map(item => item.id));
  const missing = originals.filter(entry => entry.result.status !== 'success' && !covered.has(entry.id)).map(entry => entry.id);
  missingRoutes = missing;
  coverage = { standalone: originals.length, originalSuccesses: originals.filter(entry => entry.result.status === 'success').length,
    independentReproductions: summaries.length, withoutSuccessfulRoute: missing };
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  coverage = { note: 'Original inventory not generated; independent reproductions do not require Octave or original results.' };
}
const report = { generatedAt, attempt, seed, implementationSha256, originalExecuted: false, cases: summaries, coverage };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: summaries.length, plots: summaries.reduce((count, item) => count + item.plots, 0),
  checks: summaries.reduce((count, item) => count + item.checks, 0), coverage, gallery: path.join(output, 'index.html') }, null, 2));
if (requireCoverage && (!missingRoutes || missingRoutes.length)) {
  throw new Error(missingRoutes ? `Cases without a successful learning route: ${missingRoutes.join(', ')}` : 'Original inventory required for complete route coverage');
}
const redirect = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attempt}/index.html"><title>Latest successful reproduction export</title><a href="${attempt}/index.html">Open latest successful export (${generatedAt})</a>`;
const pendingIndex = path.join(seedRoot, `${attempt}.tmp`);
await writeFile(pendingIndex, redirect);
await rename(pendingIndex, path.join(seedRoot, 'index.html'));
