import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../server/app.js';
import { port, stateRoot } from '../server/config.js';

test('independent API exposes exactly 52 reviewed alternatives and validates seeds and identities', async () => {
  await mkdir(stateRoot, { recursive: true });
  const stateDir = await mkdtemp(path.join(stateRoot, 'reproduction-api-'));
  const { app } = await buildApp({ stateDir });
  try {
    const get = (url: string, host = `127.0.0.1:${port}`) => app.inject({ method: 'GET', url, headers: { host } });
    const catalog = await get('/api/reproductions');
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().definitions.length, 52);
    const response = await get('/api/reproductions/hmmNbestDemo?seed=2026');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().seed, 2026);
    assert.equal(response.json().originalExecuted, false);
    assert.ok(response.json().result.plots.length);
    assert.equal((await get('/api/reproductions/missing')).statusCode, 404);
    for (const suffix of ['seed=-1', 'seed=1.5', 'seed=4294967296', 'seed=NaN', 'seed=1&command=whoami']) {
      assert.equal((await get(`/api/reproductions/hmmNbestDemo?${suffix}`)).statusCode, 400, suffix);
    }
    assert.equal((await get('/api/reproductions', 'untrusted.example')).statusCode, 403);
  } finally { await app.close(); await rm(stateDir, { recursive: true, force: true }); }
});
