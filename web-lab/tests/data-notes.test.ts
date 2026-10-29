import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataMetadata, datasetRecords } from '../server/data.js';
import { stateRoot } from '../server/config.js';

const row = { name: 'clown', kind: 'mat', status: 'needs_investigation', references: ['demos/fixture.m'],
  local_paths: [], mat_files: [] };
test('optional dataset notes preserve valid strings without breaking old or malformed-note records', () => {
  const note = 'MATLAB builtin; not redistributed. Availability is not runtime proof.';
  const rows = datasetRecords([row, { ...row, name: 'annotated', note }, { ...row, name: 'bad-note', note: { unexpected: true } },
    null, {}, { ...row, references: 42 }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].note, undefined);
  assert.equal(rows[1].note, note);
  assert.equal(rows[2].name, 'bad-note');
  assert.equal(rows[2].note, undefined);
});
test('read-only dataset metadata returns notes and file-driven totals without rewriting the audit', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'data-notes-'));
  const note = 'Optional generated cache, not a required redistributed dataset.';
  const bytes = JSON.stringify({ generated_at: 'fixture', datasets: [{ ...row, name: 'cacheFixture', note }],
    referenced_datasets: 1, available_datasets: 0, bundled_mat_files: 0 });
  try {
    await writeFile(path.join(dir, 'data-audit.json'), bytes);
    await writeFile(path.join(dir, 'data-recovery.json'), '[]');
    const result = await dataMetadata(dir);
    assert.equal(result.audit?.datasets[0].note, note);
    assert.equal(result.audit?.referenced_datasets, 1);
    assert.equal(result.audit?.available_datasets, 0);
    assert.equal(await readFile(path.join(dir, 'data-audit.json'), 'utf8'), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
