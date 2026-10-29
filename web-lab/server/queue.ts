import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Demo, Job } from '../shared/contracts.js';
import { bootstrap, detectRuntime, localRoot, repoRoot, sharedRoot, stateRoot } from './config.js';
import { ensureUnlinkedDirectory, HttpError, jsonFile } from './files.js';
import { InventoryStore, resultFolder, runnerLock } from './inventory.js';
import { octaveUnsupported, sharedBatchBusyMessage } from '../shared/catalog.js';
import { originalJobOutcome, originalRetryStatuses, webRunLimits } from '../shared/execution.js';
import { graphicsToolkit } from './runtime-selection.js';

export function originalRunArgs(demoId: string, octave: string) {
  return [bootstrap, 'run', '--repo', repoRoot, '--output', localRoot,
    '--demo', demoId, '--octave', octave, '--timeout', String(webRunLimits.timeoutSeconds),
    '--memory-limit-mib', String(webRunLimits.memoryLimitMiB), '--graphics-toolkit', graphicsToolkit(octave),
    ...originalRetryStatuses.flatMap(status => ['--retry-status', status])];
}

export class RunQueue {
  jobs: Job[] = [];
  private child?: ChildProcess;
  private active?: Job;
  private pumping = false;
  private closing = false;
  private submissions = new Set<string>();
  private saves = Promise.resolve();
  constructor(private store: InventoryStore, private persistenceRoot = stateRoot, private batchLockRoot = sharedRoot) {}
  batchStatus() { return runnerLock(this.batchLockRoot); }
  private async requireSharedIdle() {
    if ((await this.batchStatus()).active) throw new HttpError(409, sharedBatchBusyMessage, 'shared_batch_busy');
  }
  async init() {
    await ensureUnlinkedDirectory(this.persistenceRoot);
    await ensureUnlinkedDirectory(localRoot);
    try {
      this.jobs = (await jsonFile<Job[]>(this.persistenceRoot, 'jobs.json')).slice(-100);
      for (const job of this.jobs) if (['queued', 'running'].includes(job.status)) {
        job.status = 'interrupted';
        job.message = 'Web service restarted; retry explicitly. No stored PID is ever terminated.';
        job.finishedAt = new Date().toISOString();
      }
    } catch { this.jobs = []; }
    await this.persist();
  }
  private persist() {
    // Keep an old long-running job even if many newer queued jobs were cancelled.
    const active = this.jobs.filter(j => ['queued', 'running'].includes(j.status));
    const finished = this.jobs.filter(j => !['queued', 'running'].includes(j.status));
    this.jobs = [...active, ...finished.slice(-(100 - active.length))]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const data = JSON.stringify(this.jobs, null, 2);
    this.saves = this.saves.catch(() => {}).then(async () => {
      await ensureUnlinkedDirectory(this.persistenceRoot);
      const tmp = path.join(this.persistenceRoot, `jobs-${randomUUID()}.tmp`);
      await writeFile(tmp, data, { flag: 'wx' });
      await rename(tmp, path.join(this.persistenceRoot, 'jobs.json'));
    });
    return this.saves;
  }
  async enqueue(entry: Demo) {
    if (this.closing) throw new HttpError(503, 'Service is shutting down');
    const unsupported = octaveUnsupported(entry);
    if (unsupported) throw new HttpError(409, `Unsupported in Octave; workload not executed. ${unsupported.requirement}: ${unsupported.reason}`);
    if (!entry.source || !entry.runnable || entry.safety.length) throw new HttpError(409, 'This demo is missing, a helper, or safety-blocked');
    await this.requireSharedIdle();
    const runtime = detectRuntime();
    if (!runtime.python || !runtime.octave) throw new HttpError(503, 'Python/Octave not ready. Set WEB_LAB_PYTHON and WEB_LAB_OCTAVE to absolute executable paths or provision .demo-runtime.');
    if (this.submissions.has(entry.id) || this.jobs.some(j => j.demoId === entry.id && ['queued', 'running'].includes(j.status))) {
      throw new HttpError(409, 'This demo is already queued or running');
    }
    if (this.jobs.filter(j => ['queued', 'running'].includes(j.status)).length + this.submissions.size >= 20) throw new HttpError(429, 'Queue capacity is 20');
    this.submissions.add(entry.id);
    try {
      if (!this.active && (await runnerLock(localRoot)).active) throw new HttpError(409, 'Another process holds the web-lab results lock');
      await this.requireSharedIdle();
      if (this.closing) throw new HttpError(503, 'Service is shutting down');
      const job: Job = { id: randomUUID(), demoId: entry.id, status: 'queued', createdAt: new Date().toISOString(), output: '' };
      this.jobs.push(job);
      await this.persist();
      // Persistence can fail (e.g. disk full), but must never trigger an unobserved rejection.
      void this.pump().catch(error => {
        console.error('Queue stopped:', error instanceof Error ? error.message : 'persistence error');
      });
      return job;
    } finally { this.submissions.delete(entry.id); }
  }
  async cancel(id: string) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new HttpError(404, 'Unknown job');
    if (!['queued', 'running'].includes(job.status)) throw new HttpError(409, 'Job already finished');
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.message = 'Cancelled by user. Only the owned Python process is terminated; its Windows Job Object closes the Octave tree.';
    // Never use stored PIDs or process-image names. The live handle belongs to this queue.
    if (job === this.active && this.child) this.child.kill('SIGTERM');
    await this.persist();
    return job;
  }
  private async pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    try {
      let job: Job | undefined;
      while (!this.closing && (job = this.jobs.find(j => j.status === 'queued'))) {
        this.active = job;
        try { await this.execute(job); }
        catch (e) {
          if (!isAborted(job)) {
            const busy = e instanceof HttpError && e.code === 'shared_batch_busy';
            job.status = busy ? 'busy' : 'failed';
            if (busy) delete job.startedAt;
            job.message = e instanceof Error ? e.message : 'Runner failed';
          }
        }
        job.finishedAt ??= new Date().toISOString();
        await this.persist();
        this.active = undefined;
      }
    } finally { this.pumping = false; }
  }
  private async execute(job: Job) {
    await this.requireSharedIdle();
    if ((await runnerLock(localRoot)).active) throw new Error('Web-lab results are locked by another harness');
    const runtime = detectRuntime(), entry = await this.store.entry(job.demoId);
    const unsupported = octaveUnsupported(entry);
    if (unsupported) {
      job.status = 'unsupported';
      job.message = `Workload not executed. ${unsupported.requirement}: ${unsupported.reason}`;
      return;
    }
    await this.requireSharedIdle();
    if (!runtime.python || !runtime.octave) throw new Error('Python/Octave runtime unavailable');
    // Revalidate at execution time in case the parent refreshed safety metadata.
    if (!entry.runnable || entry.safety.length || !entry.source) throw new Error('Demo is no longer runnable');
    await confinedSource(entry);
    await ensureUnlinkedDirectory(path.join(localRoot, resultFolder(entry), 'attempts'));
    if (this.closing || job.status !== 'queued') return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    await this.persist();
    if (this.closing || isAborted(job)) return;
    // Explicit retries include successes: a user click means a new attempt, not a skipped cached result.
    const args = originalRunArgs(entry.id, runtime.octave);
    // The parent can acquire its lock after submission or while this job waits.
    // Recheck at the spawn boundary; never remove or acquire the parent's lock.
    await this.requireSharedIdle();
    if (this.closing || isAborted(job)) return;
    const child = spawn(runtime.python, args, {
      cwd: repoRoot, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    this.child = child;
    let watchdog = false;
    const timer = setTimeout(() => { watchdog = true; child.kill('SIGTERM'); }, webRunLimits.serviceWatchdogSeconds * 1000);
    const append = (chunk: Buffer) => { job.output = (job.output + chunk.toString('utf8')).slice(-65536); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      job.exitCode = code;
      if (!isAborted(job)) {
        const result = await this.store.local(entry);
        const fresh = !!result?.started_at && Date.parse(result.started_at) >= Date.parse(job.startedAt!);
        job.status = originalJobOutcome(result, code, fresh, watchdog);
        job.message = result?.status === 'unsupported'
          ? `Workload not executed in Octave. ${result.requirement ?? ''}: ${result.message ?? 'Unsupported workload'}`
          : watchdog ? `${webRunLimits.serviceWatchdogSeconds}s service watchdog terminated the owned runner.`
          : fresh ? result?.message || result?.error?.message || `Original harness outcome: ${result?.status}`
          : 'Harness exited without a fresh attempt. Inspect runner output (possibly a lock or initialization error).';
      }
    } finally { clearTimeout(timer); this.child = undefined; }
  }
  async shutdown() {
    this.closing = true;
    if (this.active && this.child) {
      this.active.status = 'interrupted';
      this.active.finishedAt = new Date().toISOString();
      this.active.message = 'Service shutdown terminated its owned runner.';
      this.child.kill('SIGTERM');
    }
    for (const job of this.jobs) if (job.status === 'queued') job.status = 'interrupted';
    await this.persist();
  }
  emergencyStop() { this.child?.kill('SIGTERM'); }
}
function isAborted(job: Job) { return job.status === 'cancelled' || job.status === 'interrupted'; }
async function confinedSource(entry: Demo) {
  const { confinedFile } = await import('./files.js');
  await confinedFile(repoRoot, entry.source!, 1024 * 1024);
  await confinedFile(repoRoot, 'demo-lab/run_demos.py', 1024 * 1024);
}
