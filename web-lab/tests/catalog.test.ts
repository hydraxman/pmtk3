import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Demo, HistoricalAlias } from '../shared/contracts.js';
import { canRunInOctave, demoExecutedSuccess, demoSearchText, executionStatus, historicalAliases, inventoryMetrics } from '../shared/catalog.js';
import { stateRoot } from '../server/config.js';
import { InventoryStore } from '../server/inventory.js';

function renamed(name: string, historical: string): Demo {
  const alias: HistoricalAlias = { published_stem: historical, old_source: `demos/${historical}.m`,
    source: `demos/${name}.m`, commit: '302750aa3ad5c2ec1c5270502a4f0e453ddaaff7', date: '2019-09-09', change: 'R100' };
  return { id: name, name, source: alias.source, sha256: 'abc', description: 'Fixture',
    kind: 'demo', entry_type: 'script', runnable: true, safety: [], tags: [], chapters: [],
    published: [{ page: `docs/${historical}.html`, chapter: '', images: [], published_stem: historical, historical_alias: alias }],
    historical_aliases: [alias], interactive: false, result: { status: 'pending', success: false, figures: [] } };
}
test('verified historical names are searchable without creating missing-source entries', () => {
  const demos = [renamed('huberLossPlot', 'huberLossDemo'), renamed('svmRegrDemo', 'kernelRegrDemo')];
  assert.ok(demoSearchText(demos[0]).includes('huberlossdemo'));
  assert.ok(demoSearchText(demos[1]).includes('kernelregrdemo'));
  assert.equal(historicalAliases(demos[0]).length, 1, 'Alias repeated in published metadata must be deduplicated');
  const metrics = inventoryMetrics(demos, { source_missing_unique: 0 });
  assert.deepEqual(metrics, { sources: 2, runnable: 2, blocked: 0, unsupported: 0, published: 2, mapped: 2, renames: 2 });
  const zero = inventoryMetrics([], { m_files: 0, feasible_candidates: 0, source_matched_unique: 0,
    historical_alias_unique: 0, unique_published_demo_stems: 0, blocked_candidates: 0 });
  assert.deepEqual(zero, { sources: 0, runnable: 0, blocked: 0, unsupported: 0, published: 0, mapped: 0, renames: 0 });
});
test('historical API selectors resolve to the canonical original ID, not arbitrary paths', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'alias-test-'));
  try {
    const demos = [renamed('huberLossPlot', 'huberLossDemo'), renamed('svmRegrDemo', 'kernelRegrDemo')];
    await writeFile(path.join(dir, 'inventory.json'), JSON.stringify({ entries: demos, chapters: [], counts: {} }));
    const store = new InventoryStore(dir);
    assert.equal((await store.entry('huberLossDemo')).id, 'huberLossPlot');
    assert.equal((await store.entry('kernelRegrDemo')).id, 'svmRegrDemo');
    assert.equal((await store.entry('demos/kernelRegrDemo.m')).source, 'demos/svmRegrDemo.m');
    await assert.rejects(() => store.entry('../../Windows/system32/cmd.exe'), /Unknown demo ID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('static eligibility and unsupported policy stay separate from runtime dependency outcomes', () => {
  const runtime = renamed('runtimeFixture', 'runtimeFixtureOld');
  runtime.result = { status: 'unsupported', success: false, figures: [], message: 'Runtime dependency unavailable' };
  const policy = renamed('policyFixture', 'policyFixtureOld');
  policy.engine_constraints = [{ engine: 'octave', status: 'unsupported', requirement: 'MATLAB-only function',
    reason: 'Declared static engine policy' }];
  const metrics = inventoryMetrics([runtime, policy], {});
  assert.equal(metrics.runnable, 1, 'A runtime outcome must not alter static eligibility');
  assert.equal(metrics.unsupported, 1, 'Only declared static engine constraints belong in the policy counter');
  assert.equal(executionStatus(runtime), 'unsupported');
  assert.equal(executionStatus(policy), 'unsupported');
  assert.equal(canRunInOctave(runtime), false, 'The current execution gate still respects known unsupported outcomes');
  assert.equal(demoExecutedSuccess(runtime), false);
  assert.equal(demoExecutedSuccess(policy), false);
});
