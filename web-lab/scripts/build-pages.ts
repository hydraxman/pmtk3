import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Inventory } from '../shared/contracts.js';
import { runReproduction } from '../shared/reproductions/index.js';
import { hasReproduction, reproductionIds } from '../shared/reproductions/manifest.js';
import { renderPlotSvg } from './reproduction-svg.js';
import { chapterGuides, guides, guideFor } from '../pages/content.js';
import type { PublicCatalog, PublicDemo, PublicDetail, PublicImage } from '../pages/types.js';

const web = path.dirname(path.dirname(fileURLToPath(import.meta.url))), repo = path.dirname(web);
const output = path.join(web, 'dist', 'pages'), resultRoot = path.join(repo, 'demo-results');
const inventory: Inventory = JSON.parse(await readFile(path.join(resultRoot, 'inventory.json'), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A committed source revision is required');
await readFile(path.join(output, 'index.html'));
await mkdir(path.join(output, 'images'), { recursive: true });
await mkdir(path.join(output, 'data'), { recursive: true });
const digest = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');
const assets = new Set<string>(), entries: PublicDemo[] = [];
let writtenBytes = 0, reproductionCount = 0;
async function image(content: Buffer | string, extension: 'png' | 'svg', title: string, kind: PublicImage['kind']) {
  if (extension === 'png' && !Buffer.from(content).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Not a valid PNG: ${title}`);
  }
  const sha256 = digest(content), url = `images/${sha256}.${extension}`;
  if (!assets.has(url)) {
    await writeFile(path.join(output, url), content);
    assets.add(url); writtenBytes += Buffer.byteLength(content);
  }
  return { url, sha256, title, kind };
}
function chapterKeys(ids: string[]) {
  return ids.map(id => {
    const number = id.match(/^\((\d+)\)-/)?.[1];
    if (!number || !chapterGuides.some(guide => guide.key === number)) throw new Error(`Unreviewed chapter: ${id}`);
    return number;
  });
}
function usefulDescription(description: string) {
  if (!description || /[={}];?|^%|^[A-Za-z]\s*=|C:\\|\/Users\//.test(description)) return '';
  return description.replace(/\s+/g, ' ').slice(0, 350);
}
for (const entry of inventory.entries) {
  if (!entry.source) throw new Error(`Unresolved source mapping: ${entry.id}`);
  const source = path.resolve(repo, entry.source);
  if (!source.startsWith(`${repo}${path.sep}`)) throw new Error('Source path escaped repository');
  const sourceSha256 = digest(await readFile(source));
  if (entry.sha256 !== sourceSha256) throw new Error(`Refresh the source inventory before publishing: ${entry.id}`);
  const original = entry.result.status === 'success';
  if (original && entry.result.source_sha256 !== sourceSha256) throw new Error(`Stale original result: ${entry.id}`);
  const chapters = chapterKeys(entry.chapters), images: PublicImage[] = [], seen = new Set<string>();
  const file = `${digest(entry.id).slice(0, 24)}.json`;
  const detail: PublicDetail = {
    id: entry.id, title: entry.name, description: usefulDescription(entry.description),
    source: entry.source, sourceSha256, chapters, guide: guideFor(entry.id, chapters),
    runnable: entry.runnable, status: entry.result.status,
    kind: original ? 'original' : hasReproduction(entry.id) ? 'reproduction' : !entry.runnable ? 'helper' : 'unavailable',
    imageCount: 0, detail: `data/${file}`, images,
  };
  if (original) {
    detail.attempt = { id: entry.result.attempt_id ?? '', finishedAt: entry.result.finished_at ?? '',
      seconds: entry.result.duration_seconds };
    for (const name of entry.result.figures) {
      const sourceImage = await realpath(path.resolve(resultRoot, name));
      if (!sourceImage.startsWith(`${resultRoot}${path.sep}`)) throw new Error('Image escaped original results');
      const item = await image(await readFile(sourceImage), 'png', `${entry.name} · 实际输出`, 'original');
      if (!seen.has(item.sha256)) { images.push(item); seen.add(item.sha256); }
    }
    images.forEach((item, i) => { item.title += ` ${i + 1}`; });
  } else if (hasReproduction(entry.id)) {
    const run = runReproduction(entry.id, 42);
    reproductionCount++;
    detail.title = run.title; detail.description = run.description;
    detail.reproduction = { method: run.method, description: run.description, differences: run.differences,
      seed: run.seed, metrics: run.result.metrics, checks: run.result.checks };
    for (const plot of run.result.plots) images.push(await image(renderPlotSvg(plot), 'svg', plot.title, 'reproduction'));
  }
  if (detail.kind === 'unavailable') throw new Error(`No successful learning route: ${entry.id}`);
  detail.imageCount = images.length;
  // Late original captures tend to include finished labels and annotations.
  detail.thumbnail = original ? images.at(-1) : images[0];
  if (entry.id === 'mixGaussVbDemoFaithful') {
    const reviewedScatter = images.find(item => item.sha256 === 'af65cc05707684190132c16bfa2883f50d53a8a8693534a9e549a16cfa151498');
    if (reviewedScatter) detail.thumbnail = reviewedScatter;
  }
  await writeFile(path.join(output, 'data', file), JSON.stringify(detail));
  const { images: _images, reproduction: _reproduction, attempt: _attempt, ...summary } = detail;
  entries.push(summary);
}
if (reproductionCount !== reproductionIds.length) throw new Error('The full reviewed reproduction set was not published');
const chapters = chapterGuides.map(guide => ({ ...guide, count: entries.filter(entry => entry.chapters.includes(guide.key)).length }));
for (const chapter of chapters) {
  const published = inventory.chapters.find(item => item.id.startsWith(`(${chapter.number})-`));
  if (!published || chapter.count !== published.demo_pages) throw new Error(`Chapter mapping count mismatch: ${chapter.key}`);
}
const catalog: PublicCatalog = {
  schema: 1, generatedAt: new Date().toISOString(), sourceCommit, repository: 'https://github.com/hydraxman/pmtk3',
  chapters, guides, entries,
  stats: { sources: entries.length, runnable: entries.filter(entry => entry.runnable).length,
    originalSuccesses: entries.filter(entry => entry.kind === 'original').length, reproductions: reproductionCount,
    mapped: entries.filter(entry => entry.chapters.length).length,
    unmapped: entries.filter(entry => !entry.chapters.length).length, uniqueImages: assets.size, chapterCount: chapters.length },
};
await writeFile(path.join(output, 'catalog.json'), JSON.stringify(catalog));
await writeFile(path.join(output, 'license.txt'), await readFile(path.join(repo, 'license.txt')));
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
await writeFile(path.join(output, 'publication.json'), JSON.stringify({
  generatedAt: catalog.generatedAt, sourceCommit, ...catalog.stats, imageBytes: writtenBytes,
  provenance: 'Actual source-matched successful Octave captures and newly computed TypeScript reproductions at seed 42. No historical screenshot substitution.',
  chapterPolicy: 'Official published-output directory associations only. Other topic links are explicitly editorial study suggestions.',
  contents: 'Original chapter summaries; no textbook text, private runtime paths, raw datasets, logs, credentials or executables.',
}, null, 2));
console.log(JSON.stringify({ ...catalog.stats, imageMiB: +(writtenBytes / 1048576).toFixed(2), output, sourceCommit }, null, 2));
