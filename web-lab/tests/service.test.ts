import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from '../server/app.js';
import { bootstrap, detectRuntime, port, stateRoot } from '../server/config.js';
import { confinedFile, ensureUnlinkedDirectory, jsonFile } from '../server/files.js';
import { InventoryStore, resultFolder, runnerLock } from '../server/inventory.js';
import { RunQueue } from '../server/queue.js';
import type { DataMetadata, Demo, Snapshot } from '../shared/contracts.js';

const host = `127.0.0.1:${port}`, origin = `http://${host}`;
test('artifact confinement rejects traversal, alternate streams, symlinks and junctions', async t => {
  await mkdir(stateRoot, { recursive: true });
  const root = await mkdtemp(path.join(stateRoot, 'file-test-'));
  try {
    await mkdir(path.join(root, 'real'));
    await writeFile(path.join(root, 'real', 'data.txt'), 'fixture');
    assert.equal(await confinedFile(root, 'real/data.txt'), path.join(root, 'real', 'data.txt'));
    for (const candidate of ['../secret', '/Windows/win.ini', 'real\\data.txt', 'C:/Windows/win.ini', 'real/./data.txt', 'real/data.txt:stream', 'real//data.txt']) {
      await assert.rejects(() => confinedFile(root, candidate), /Invalid artifact path/);
    }
    try {
      await symlink(path.join(root, 'real'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(() => confinedFile(root, 'linked/data.txt'), /Linked/);
      await assert.rejects(() => ensureUnlinkedDirectory(path.join(root, 'linked', 'output')), /Linked output/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') t.diagnostic('Symlink creation unavailable on this host');
      else throw e;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('harness folder hash matches Python sha256 slug convention', () => {
  assert.equal(resultFolder({ name: 'hello/world', id: 'abc' }), 'demos/hello_world-ba7816bf8f01');
});
test('active parent lock stays busy regardless of age, and shared running results are read-only', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'shared-reader-test-'));
  try {
    const lockFile = path.join(dir, '.runner.lock');
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, started_at: '2000-01-01T00:00:00Z' }));
    await utimes(lockFile, new Date('2000-01-01'), new Date('2000-01-01'));
    const lock = await runnerLock(dir);
    assert.equal(lock.active, true);
    assert.match(lock.message, /Busy/);
    const demo: Demo = { id: 'fixtureDemo', name: 'fixtureDemo', source: 'demos/fixtureDemo.m', sha256: 'abc',
      description: 'Fixture', kind: 'demo', entry_type: 'script', runnable: true, safety: [], tags: [],
      chapters: [], published: [], interactive: false,
      result: { status: 'running', success: false, figures: [], source_sha256: 'abc', runner_pid: process.pid } };
    const json = JSON.stringify({ generated_at: '2026-10-28T00:00:00Z', entries: [demo], chapters: [], counts: { m_files: 1 } });
    await writeFile(path.join(dir, 'inventory.json'), json);
    const inventory = await new InventoryStore(dir).shared();
    assert.equal(inventory.entries[0].result.status, 'running');
    assert.equal(await readFile(path.join(dir, 'inventory.json'), 'utf8'), json);
    assert.equal(JSON.parse(await readFile(lockFile, 'utf8')).pid, process.pid);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('embedded Python bootstrap delegates the existing harness CLI without import errors', async t => {
  const python = detectRuntime().python;
  if (!python) return t.skip('Python is not provisioned; runtime-independent tests still run');
  const { stdout } = await promisify(execFile)(python, [bootstrap, '--help'], { timeout: 15_000, windowsHide: true });
  assert.match(stdout, /run_demos\.py/);
  assert.match(stdout, /--demo/);
});
test('queue restart interrupts persisted work without killing stored PIDs; queued cancellation persists', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'queue-test-'));
  try {
    const jobs = [{ id: 'existing', demoId: 'fixture', status: 'running', createdAt: new Date().toISOString(), output: '' }];
    await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
    const queue = new RunQueue(new InventoryStore(), dir);
    await queue.init();
    assert.equal(queue.jobs[0].status, 'interrupted');
    assert.match(queue.jobs[0].message!, /No stored PID is ever terminated/);
    queue.jobs.push({ id: 'queued', demoId: 'fixture', status: 'queued', createdAt: new Date().toISOString(), output: '' });
    const cancelled = await queue.cancel('queued');
    assert.equal(cancelled.status, 'cancelled');
    const saved = await jsonFile<typeof queue.jobs>(dir, 'jobs.json');
    assert.equal(saved.find(j => j.id === 'queued')?.status, 'cancelled');
    await assert.rejects(() => queue.cancel('queued'), /already finished/);
    await queue.shutdown();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('local HTTP API validates host, origin, tokens, body size, IDs and declared artifacts', async () => {
  await mkdir(stateRoot, { recursive: true });
  const stateDir = await mkdtemp(path.join(stateRoot, 'service-test-'));
  const { app } = await buildApp({ stateDir });
  try {
    const get = (url: string, headers = { host }) => app.inject({ method: 'GET', url, headers });
    assert.equal((await get('/api/health')).statusCode, 200);
    assert.equal((await get('/api/health', { host: 'attacker.example' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/state', headers: { host, origin: 'https://attacker.example' } })).statusCode, 403);
    const response = await get('/api/state'), state = response.json<Snapshot>();
    assert.equal(response.statusCode, 200);
    assert.ok(state.entries.length >= 570);
    assert.equal(state.entries.filter(e => !!e.source).length, state.counts.m_files);
    assert.equal(state.entries.length, state.counts.unique_inventory_entries);
    const headers = { host, origin, 'content-type': 'application/json', 'x-lab-token': state.csrf };
    const post = (payload: object | string, custom = headers) =>
      app.inject({ method: 'POST', url: '/api/runs', headers: custom, payload });
    assert.equal((await post({ demoId: 'x' }, { ...headers, origin: 'https://attacker.example' })).statusCode, 403);
    assert.equal((await post({ demoId: 'x' }, { ...headers, 'x-lab-token': '' })).statusCode, 403);
    assert.equal((await post({ demoId: 'x' }, { ...headers, origin: '' })).statusCode, 403);
    assert.equal((await post({ demoId: '../../Windows/system32/cmd.exe' })).statusCode, 404);
    assert.equal((await post({ demoId: 'unknown', octave: 'cmd.exe' })).statusCode, 400);
    assert.equal((await post(JSON.stringify({ demoId: 'x'.repeat(5000) }))).statusCode, 413);
    const blocked = state.entries.find(e => e.safety.length)!;
    assert.ok(blocked);
    assert.equal((await post({ demoId: blocked.id })).statusCode, 409);
    const unsupported = state.entries.find(e => e.result.status === 'unsupported');
    if (unsupported) {
      assert.equal(unsupported.result.success, false);
      assert.equal(unsupported.result.workload_executed, false);
      const beforeJobs = state.jobs.length;
      assert.equal((await post({ demoId: unsupported.id })).statusCode, 409);
      assert.equal((await get('/api/state')).json<Snapshot>().jobs.length, beforeJobs);
    }
    const unmapped = state.entries.find(e => !e.source);
    if (unmapped) assert.equal((await post({ demoId: unmapped.id })).statusCode, 409);
    else assert.equal(state.counts.source_missing_unique, 0);
    const detail = await get(`/api/demos/${encodeURIComponent(state.entries[0].id)}`);
    assert.equal(detail.statusCode, 200);
    assert.ok(detail.json().source);
    const token = Buffer.from(JSON.stringify({ id: state.entries[0].id, scope: 'reference', path: '../../Windows/win.ini' })).toString('base64url');
    assert.equal((await get(`/api/artifacts/${token}`)).statusCode, 403);
    assert.equal((await get('/api/artifacts/not-a-json-token')).statusCode, 400);
    const published = state.entries.find(e => e.published.some(p => p.images.length))!;
    const pd = (await get(`/api/demos/${encodeURIComponent(published.id)}`)).json();
    const image = await get(pd.references[0].url);
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal((await get('/api/unknown')).statusCode, 404);
    assert.equal((await get('/api/numerics')).json().seed, 42);
    const parity = (await get('/api/numerics/parity')).json();
    assert.deepEqual(parity.beta.posterior, [4.5, 2.5]);
    assert.equal(parity.pca.eigenvalues[0], 2.5);
    assert.equal(parity.hmm.gammaOrientation, 'state × time');
    const reportResponse = await get('/api/numerics/parity/check');
    if (reportResponse.statusCode === 200) {
      const report = reportResponse.json();
      assert.equal(report.passed, true);
      assert.equal(report.checksPassed, 6);
      assert.equal(report.models.find((m: { model: string }) => m.model === 'hmm').absoluteTolerance, 1e-12);
    } else assert.equal(reportResponse.statusCode, 503, 'Only an unavailable optional reference may prevent this report');
    const metadataResponse = await get('/api/data');
    assert.equal(metadataResponse.statusCode, 200);
    const metadata = metadataResponse.json<DataMetadata>();
    assert.ok(Array.isArray(metadata.recovery));
    if (metadata.audit) {
      assert.equal(metadata.audit.available_datasets, metadata.audit.datasets.filter(d => d.status === 'available').length);
      assert.equal(metadata.audit.referenced_datasets, metadata.audit.datasets.length);
      assert.ok(metadata.audit.datasets.every(d => Array.isArray(d.local_paths)));
    }
  } finally { await app.close(); await rm(stateDir, { recursive: true, force: true }); }
});
