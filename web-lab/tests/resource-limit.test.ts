import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Demo, DemoResult } from '../shared/contracts.js';
import { executedSuccess } from '../shared/catalog.js';
import { needsAttention, originalJobOutcome } from '../shared/execution.js';
import { originalRunArgs } from '../server/queue.js';
import { InventoryStore } from '../server/inventory.js';
import { stateRoot } from '../server/config.js';

test('resource limits are failures even with exit zero, and only fresh outcomes label the new job', () => {
  const result: DemoResult = { status: 'resource_limit', success: false, figures: ['partial.png'] };
  assert.equal(executedSuccess(result), false);
  assert.equal(needsAttention(result.status), true);
  assert.equal(originalJobOutcome(result, 1, true, false), 'resource_limit');
  assert.equal(originalJobOutcome(result, 0, true, false), 'resource_limit');
  assert.equal(originalJobOutcome(result, 1, false, false), 'failed');
  assert.equal(originalJobOutcome({ status: 'success', success: true, figures: [] }, 0, true, false), 'success');
  assert.equal(originalJobOutcome({ status: 'success', success: true, figures: [] }, 0, true, true), 'failed');
});
test('web CLI uses bounded memory and explicitly includes resource-limit retries without shell interpolation', () => {
  const args = originalRunArgs('fixtureDemo', 'C:/fixture/octave-cli.exe');
  assert.equal(args[args.indexOf('--memory-limit-mib') + 1], '6144');
  assert.equal(args[args.indexOf('--timeout') + 1], '120');
  assert.equal(args[args.indexOf('--graphics-toolkit') + 1], 'gnuplot');
  const guiArgs = originalRunArgs('fixtureDemo', 'C:/fixture/octave-gui.exe');
  assert.equal(guiArgs[guiArgs.indexOf('--graphics-toolkit') + 1], 'qt');
  assert.equal(guiArgs.includes('gnuplot'), false, 'GUI requests cannot silently include a console-rendering fallback');
  const retries = args.flatMap((arg, i) => arg === '--retry-status' ? [args[i + 1]] : []);
  assert.ok(retries.includes('resource_limit'));
  assert.equal(retries.includes('unsupported'), false);
  assert.equal(args[args.indexOf('--demo') + 1], 'fixtureDemo');
});
test('inventory preserves resource-limit status, partial PNG references and memory evidence read-only', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'resource-limit-'));
  const demo: Demo = { id: 'resourceFixture', name: 'resourceFixture', source: null, sha256: 'fixture',
    description: 'Metadata-only unit fixture, not executed', kind: 'helper', entry_type: 'function',
    runnable: false, safety: [], tags: [], chapters: [], published: [], interactive: false,
    result: { status: 'resource_limit', success: false, figures: ['demos/fixture/attempts/partial.png'],
      runtime_profile: { executable: 'fixture/octave-cli.exe', binary_kind: 'console', frontend: 'unit fixture only',
        qt_environment: {}, path_directories: ['fixture/not-an-actual-runtime'] },
      memory_limit_mib: 6144, memory_guard: { enabled: true, limit_bytes: 6442450944, job_commit_limit_bytes: 6442450944,
        poll_interval_seconds: 0.15, peak_sampled_private_bytes: 6000000000, violation: { reason: 'Unit fixture allocation rejection' } } } };
  const bytes = JSON.stringify({ entries: [demo], chapters: [], counts: {} });
  try {
    await writeFile(path.join(dir, 'inventory.json'), bytes);
    const store = new InventoryStore(dir), actual = (await store.shared()).entries[0];
    assert.equal(actual.result.status, 'resource_limit');
    assert.equal(actual.result.success, false);
    assert.deepEqual(actual.result.figures, demo.result.figures);
    assert.deepEqual(actual.result.memory_guard, demo.result.memory_guard);
    assert.deepEqual(actual.result.runtime_profile, demo.result.runtime_profile, 'New defaults must not rewrite a recorded Console profile');
    const detail = await store.detail(demo.id);
    assert.equal(detail.attempts.at(-1)?.figures.length, 1);
    assert.equal(await readFile(path.join(dir, 'inventory.json'), 'utf8'), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
