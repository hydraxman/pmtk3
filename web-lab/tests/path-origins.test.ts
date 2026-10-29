import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { localRoot, stateRoot } from '../server/config.js';
import { InventoryStore, resultFolder } from '../server/inventory.js';
import type { Demo } from '../shared/contracts.js';

test('optional numerical-origin proof is linked only when declared and remains path-confined', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'path-proof-'));
  const demo: Demo = { id: `path-proof-${randomUUID()}`, name: 'pathProofFixture', source: null,
    description: 'Artifact fixture, never executed', sha256: 'fixture', kind: 'helper', entry_type: 'function',
    runnable: false, safety: [], tags: [], chapters: [], published: [], interactive: false,
    result: { status: 'pending', success: false, figures: [] } };
  const folder = resultFolder(demo), localDir = path.join(localRoot, folder);
  const proofPath = `${folder}/attempts/fixture/path-origins.json`;
  try {
    await mkdir(path.dirname(path.join(localRoot, proofPath)), { recursive: true });
    const proof = JSON.stringify({ policy: 'pmtk-semantic-origins-v1', status: 'passed', checks: [], semantic_checks: {} });
    await writeFile(path.join(localRoot, proofPath), proof);
    await writeFile(path.join(dir, 'inventory.json'), JSON.stringify({ entries: [demo], chapters: [], counts: {} }));
    const result = { ...demo.result, id: demo.id, path_origins: proofPath };
    await writeFile(path.join(localDir, 'result.json'), JSON.stringify(result));
    const store = new InventoryStore(dir);
    const detail = await store.detail(demo.id);
    const link = detail.attempts.flatMap(a => a.artifacts).find(a => a.name === 'path-origins.json')!;
    assert.ok(link);
    const artifact = await store.artifact(link.url.split('/').at(-1)!);
    assert.equal(artifact.ext, '.json');
    assert.equal(await readFile(artifact.file, 'utf8'), proof);
    const token = (relative: string) => Buffer.from(JSON.stringify({ id: demo.id, scope: 'local', path: relative })).toString('base64url');
    await assert.rejects(() => store.artifact(token(`${folder}/undeclared.json`)), /not declared/);
    await writeFile(path.join(localDir, 'result.json'), JSON.stringify({ ...result, path_origins: '../../outside.json' }));
    await assert.rejects(() => store.artifact(token('../../outside.json')), /Invalid artifact path/);
    await writeFile(path.join(localDir, 'result.json'), JSON.stringify({ ...demo.result, id: demo.id }));
    assert.equal((await store.detail(demo.id)).attempts.flatMap(a => a.artifacts).some(a => a.name === 'path-origins.json'), false,
      'Old attempts are never given synthetic proof links');
  } finally {
    await rm(localDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
