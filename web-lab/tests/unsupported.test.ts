import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Demo, Job } from '../shared/contracts.js';
import { canRunInOctave, demoExecutedSuccess, executedSuccess, executionStatus, inventoryMetrics, jobForDisplay, octaveUnsupported } from '../shared/catalog.js';
import { InventoryStore, resultFolder } from '../server/inventory.js';
import { RunQueue } from '../server/queue.js';
import { localRoot, stateRoot } from '../server/config.js';

function fixture(): Demo {
  return { id: 'matlabOnlyFixture', name: 'matlabOnlyFixture', source: 'demos/matlabOnlyFixture.m', sha256: 'new-source',
    description: 'Requires MATLAB-specific workload', kind: 'demo', entry_type: 'function', runnable: true,
    engine_constraints: [{ engine: 'octave', status: 'unsupported', requirement: 'MATLAB memmapfile', line: 8,
      reason: 'The leading isOctave() guard returns before the workload.' }],
    safety: [], tags: [], chapters: [], published: [], interactive: false,
    result: { status: 'success', success: true, figures: [], source_sha256: 'old-source', attempt_id: 'retained-evidence',
      attempt_result: 'attempt-evidence.json' } };
}
test('engine constraints override a legacy success in display, feasibility, metrics, and job history', () => {
  const demo = fixture();
  assert.equal(executionStatus(demo), 'unsupported');
  assert.equal(canRunInOctave(demo), false);
  assert.equal(demoExecutedSuccess(demo), false);
  const metrics = inventoryMetrics([demo], { feasible_candidates: 1 });
  assert.equal(metrics.runnable, 0, 'A stale feasible count must not schedule an unsupported workload');
  assert.equal(metrics.unsupported, 1);
  const job: Job = { id: 'old-job', demoId: demo.id, status: 'success', createdAt: '2026-10-28T00:00:00Z', output: '' };
  assert.equal(jobForDisplay(job, demo).status, 'unsupported');
  assert.equal(jobForDisplay(job, demo).originalStatus, 'success');
  assert.equal(job.status, 'success', 'Historical evidence is not mutated in place');
});
test('explicit non-execution flags never qualify as a nonvisual success', () => {
  const result = { status: 'success', success: true, figures: [], workload_executed: false,
    execution_disposition: 'not_executed', message: 'Completed successfully' };
  assert.equal(executedSuccess(result), false);
  const demo = fixture();
  delete demo.engine_constraints;
  demo.result = result;
  assert.ok(octaveUnsupported(demo));
  assert.match(octaveUnsupported(demo)!.reason, /was not executed/);
  assert.equal(canRunInOctave(demo), false);
});
test('read-only normalization reclassifies old success without modifying immutable attempt evidence', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'unsupported-reader-'));
  try {
    const demo = fixture(), evidence = JSON.stringify(demo.result);
    const inventory = JSON.stringify({ entries: [demo], chapters: [], counts: {} });
    await writeFile(path.join(dir, 'attempt-evidence.json'), evidence);
    await writeFile(path.join(dir, 'inventory.json'), inventory);
    const actual = (await new InventoryStore(dir).shared()).entries[0].result;
    assert.equal(actual.status, 'unsupported');
    assert.equal(actual.success, false);
    assert.equal(actual.workload_executed, false);
    assert.equal(actual.execution_disposition, 'not_executed');
    assert.equal(actual.requirement, 'MATLAB memmapfile');
    assert.equal(actual.attempt_result, 'attempt-evidence.json');
    assert.equal(await readFile(path.join(dir, 'attempt-evidence.json'), 'utf8'), evidence);
    assert.equal(await readFile(path.join(dir, 'inventory.json'), 'utf8'), inventory);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('normal and repeated unsupported requests are refused before queueing or child creation', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'unsupported-queue-'));
  const queue = new RunQueue(new InventoryStore(), dir);
  try {
    await queue.init();
    for (let retry = 0; retry < 2; retry++) await assert.rejects(() => queue.enqueue(fixture()), /Unsupported in Octave/);
    assert.equal(queue.jobs.length, 0);
    await queue.shutdown();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('unsupported protocol survives a newer local exit-0 record and malformed local evidence', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'unsupported-merge-'));
  const demo = fixture();
  demo.id = `unsupported-fixture-${randomUUID()}`;
  delete demo.engine_constraints;
  demo.result = { status: 'unsupported', success: false, figures: [], engine: 'octave',
    workload_executed: false, execution_disposition: 'not_executed', requirement: 'MATLAB memmapfile',
    classification_only: true, started_at: '2020-01-01T00:00:00Z' };
  const localDir = path.join(localRoot, resultFolder(demo));
  try {
    await mkdir(localDir, { recursive: true });
    const bytes = JSON.stringify({ id: demo.id, status: 'success', success: true, figures: [],
      started_at: '2099-01-01T00:00:00Z', source_sha256: 'old-source', attempt_id: 'most-recent-local-exit-zero' });
    await writeFile(path.join(localDir, 'result.json'), bytes);
    await writeFile(path.join(dir, 'inventory.json'), JSON.stringify({ entries: [demo], chapters: [], counts: {} }));
    const store = new InventoryStore(dir);
    const merged = (await store.merged()).entries[0];
    assert.equal(merged.result.status, 'unsupported');
    assert.equal(merged.result.success, false);
    assert.equal(merged.result.attempt_id, 'most-recent-local-exit-zero');
    assert.equal(merged.result.workload_executed, false);
    const sharedClassification = (await store.detail(demo.id)).attempts.find(a => a.result.classification_only)!;
    assert.match(sharedClassification.label, /capability classification \(not a run\)/);
    assert.equal(await readFile(path.join(localDir, 'result.json'), 'utf8'), bytes);
    await writeFile(path.join(localDir, 'result.json'), '{broken');
    assert.equal((await store.local(merged))?.status, 'unsupported', 'An unreadable artifact cannot defeat the current support classification');
  } finally {
    await rm(localDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
