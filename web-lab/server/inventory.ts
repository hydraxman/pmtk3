import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Asset, AttemptView, Demo, DemoDetail, DemoResult, Inventory, Snapshot } from '../shared/contracts.js';
import { localRoot, repoRoot, sharedRoot } from './config.js';
import { confinedFile, HttpError, jsonFile, textFile } from './files.js';
import { historicalAliases, octaveUnsupported } from '../shared/catalog.js';

export function resultFolder(entry: Pick<Demo, 'id' | 'name'>) {
  const slug = entry.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 90);
  const hash = createHash('sha256').update(entry.id).digest('hex').slice(0, 12);
  return `demos/${slug}-${hash}`;
}
const allowedStatuses = new Set(['pending', 'success', 'failed', 'timeout', 'resource_limit', 'runner_error',
  'interrupted', 'stale', 'running', 'helper', 'blocked', 'source_missing', 'unsupported']);
function normalizeResult(result: DemoResult, entry: Demo): DemoResult {
  const unsupported = octaveUnsupported(entry, result);
  if (unsupported) {
    // Classification takes precedence over old exit-0 records and hash staleness.
    // The underlying result/artifact files remain immutable and are never rewritten here.
    return { ...result, status: 'unsupported', success: false, workload_executed: false,
      execution_disposition: 'not_executed', requirement: unsupported.requirement,
      message: unsupported.reason, figures: Array.isArray(result?.figures) ? result.figures.filter(p => typeof p === 'string') : [] };
  }
  if (!allowedStatuses.has(result.status) || result.success !== (result.status === 'success') ||
    !Array.isArray(result.figures) || !result.figures.every(p => typeof p === 'string')) {
    return { status: 'runner_error', success: false, figures: [], message: 'Invalid result protocol' };
  }
  if (result.source_sha256 && result.source_sha256 !== entry.sha256) {
    return { ...result, status: 'stale', success: false, message: 'Source changed; these artifacts are from a previous version.' };
  }
  return result;
}
export class InventoryStore {
  private cached?: Inventory;
  private lastRead = 0;
  warning?: string;
  constructor(private sharedDirectory = sharedRoot) {}
  async shared(force = false): Promise<Inventory> {
    if (!force && this.cached && Date.now() - this.lastRead < 1800) return this.cached;
    try {
      const raw = await jsonFile<Inventory>(this.sharedDirectory, 'inventory.json');
      if (!Array.isArray(raw.entries) || !Array.isArray(raw.chapters) || !raw.counts) throw new Error('Invalid inventory');
      const ids = new Set<string>();
      for (const e of raw.entries) {
        if (typeof e.id !== 'string' || e.id.length > 250 || ids.has(e.id) || !Array.isArray(e.safety)) throw new Error('Invalid entry');
        ids.add(e.id);
        e.result = normalizeResult(e.result, e);
      }
      this.cached = raw;
      this.lastRead = Date.now();
      this.warning = undefined;
    } catch {
      this.warning = 'Shared inventory is temporarily unavailable; showing the last readable snapshot.';
      if (!this.cached) throw new HttpError(503, 'Generate demo-results/inventory.json with the existing demo-lab harness first.');
    }
    return this.cached!;
  }
  async entry(id: string) {
    const entries = (await this.shared()).entries;
    const exact = entries.find(e => e.id === id);
    if (exact) return exact;
    const aliases = entries.filter(e => historicalAliases(e).some(a => a.published_stem === id || a.old_source === id));
    if (aliases.length === 1) return aliases[0];
    if (aliases.length > 1) throw new HttpError(409, 'Ambiguous historical name; use the current source ID');
    throw new HttpError(404, 'Unknown demo ID');
  }
  async local(entry: Demo): Promise<DemoResult | undefined> {
    try {
      const result = await jsonFile<DemoResult & { id: string }>(localRoot, `${resultFolder(entry)}/result.json`);
      if (result.id !== entry.id) throw new Error('Identity mismatch');
      const normalized = normalizeResult(result, entry);
      if (normalized.status === 'running' && normalized.runner_pid) {
        try { process.kill(normalized.runner_pid, 0); }
        catch { return { ...normalized, status: 'interrupted', success: false, message: 'Runner stopped before finalizing this attempt.' }; }
      }
      return normalized;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return normalizeResult({ status: 'runner_error', success: false, figures: [], message: 'Local result could not be read safely.' }, entry);
    }
  }
  async merged() {
    const inventory = await this.shared();
    const entries = await Promise.all(inventory.entries.map(async e => {
      const local = await this.local(e);
      // Prefer latest timestamp, never hide newer bulk outcomes behind an old user run.
      const effective = local && (!e.result.started_at ||
        Date.parse(local.started_at ?? '') >= Date.parse(e.result.started_at)) ? local : e.result;
      return { ...e, result: effective };
    }));
    return { generated_at: inventory.generated_at, counts: inventory.counts, chapters: inventory.chapters, entries };
  }
  private paths(entry: Demo, scope: string, result?: DemoResult) {
    if (scope === 'reference') return entry.published.flatMap(p => p.images);
    if (scope === 'source') return entry.source ? [entry.source] : [];
    if (!result) return [];
    return [...result.figures, result.log, result.attempt_result, result.harness_result, result.metadata, result.path_origins]
      .filter((p): p is string => typeof p === 'string');
  }
  private asset(entry: Demo, scope: string, relative: string): Asset {
    const token = Buffer.from(JSON.stringify({ id: entry.id, scope, path: relative })).toString('base64url');
    return { url: `/api/artifacts/${token}`, name: relative.split('/').at(-1) ?? relative };
  }
  async artifact(token: string) {
    if (token.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new HttpError(400, 'Invalid artifact token');
    let ref: { id: string; scope: string; path: string };
    try { ref = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); }
    catch { throw new HttpError(400, 'Invalid artifact token'); }
    if (typeof ref.id !== 'string' || typeof ref.path !== 'string' ||
      !['shared', 'local', 'reference', 'source'].includes(ref.scope)) throw new HttpError(400, 'Invalid artifact reference');
    const entry = await this.entry(ref.id);
    const result = ref.scope === 'local' ? await this.local(entry) : entry.result;
    if (!this.paths(entry, ref.scope, result).includes(ref.path)) throw new HttpError(403, 'Artifact not declared by this demo');
    const root = ref.scope === 'local' ? localRoot : ref.scope === 'shared' ? sharedRoot : repoRoot;
    const ext = path.extname(ref.path).toLowerCase();
    if (!['.png', '.json', '.log', '.m'].includes(ext)) throw new HttpError(403, 'Unsupported artifact type');
    const file = await confinedFile(root, ref.path);
    return { file, ext };
  }
  async detail(id: string): Promise<DemoDetail> {
    const entry = await this.entry(id), local = await this.local(entry);
    const attempt = async (label: string, scope: 'local' | 'shared', result: DemoResult): Promise<AttemptView> => {
      let log = '';
      if (result.log) {
        try { log = await textFile(scope === 'local' ? localRoot : sharedRoot, result.log, true); }
        catch { log = 'Log unavailable or refused by the file safety policy.'; }
      }
      const evidenceLabel = result.classification_only
        ? `${scope === 'local' ? 'Web lab' : 'Shared harness'} · capability classification (not a run)` : label;
      return { label: evidenceLabel, result, log, figures: result.figures.map(p => this.asset(entry, scope, p)),
        artifacts: this.paths(entry, scope, { ...result, figures: [] }).map(p => this.asset(entry, scope, p)) };
    };
    let source: string | null = null;
    if (entry.source) {
      try { source = await textFile(repoRoot, entry.source); }
      catch { source = 'Source unavailable or refused by the file safety policy.'; }
    }
    const attempts = [];
    if (local) attempts.push(await attempt('Web lab · user attempt', 'local', local));
    attempts.push(await attempt('Shared harness · bulk/latest attempt', 'shared', entry.result));
    return { demo: entry, source, attempts,
      references: entry.published.flatMap(p => p.images).map(p => this.asset(entry, 'reference', p)) };
  }
}
export async function runnerLock(root: string) {
  try {
    const lock = JSON.parse(await readFile(await confinedFile(root, '.runner.lock', 4096), 'utf8'));
    if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('Invalid lock');
    try { process.kill(lock.pid, 0); return { active: true, message: 'Busy: an external harness runner is active.' }; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return { active: false, message: 'A stale harness lock will be reclaimed by Python.' };
      return { active: true, message: 'Harness lock owner cannot be inspected; conservatively treating it as active.' };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { active: false, message: 'No active harness lock.' };
    return { active: true, message: 'Unreadable harness lock; inspect it locally before running.' };
  }
}
export async function sharedProgress(): Promise<Snapshot['sharedProgress']> {
  try {
    const raw = await jsonFile<NonNullable<Snapshot['sharedProgress']>>(sharedRoot, 'progress.json');
    if (![raw.total, raw.completed, raw.started, raw.jobs].every(n => Number.isInteger(n) && n >= 0) ||
      typeof raw.updated_at !== 'string' || !Array.isArray(raw.active)) return undefined;
    return { updated_at: raw.updated_at, total: raw.total, completed: raw.completed, started: raw.started,
      jobs: raw.jobs, active: raw.active.filter((id): id is string => typeof id === 'string').slice(0, 3),
      memory_limit_mib: Number.isInteger(raw.memory_limit_mib) && raw.memory_limit_mib! >= 0 ? raw.memory_limit_mib : undefined };
  } catch { return undefined; }
}
