import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../server/app.js';
import { detectRuntime, port, stateRoot } from '../server/config.js';
import { InventoryStore } from '../server/inventory.js';
import { RunQueue } from '../server/queue.js';
import type { Snapshot } from '../shared/contracts.js';

test('active batch lock returns typed HTTP busy without queueing or changing its lock', async () => {
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'batch-http-'));
  const lock = JSON.stringify({ pid: process.pid, started_at: '2000-01-01T00:00:00Z' });
  await writeFile(path.join(dir, '.runner.lock'), lock);
  const { app, queue } = await buildApp({ stateDir: path.join(dir, 'state'), batchLockRoot: dir });
  try {
    const host = `127.0.0.1:${port}`;
    const state = (await app.inject({ method: 'GET', url: '/api/state', headers: { host } })).json<Snapshot>();
    assert.equal(state.sharedRunner.active, true);
    for (let retry = 0; retry < 2; retry++) {
      const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { demoId: 'bernoulliEntropyFig' },
        headers: { host, origin: `http://${host}`, 'content-type': 'application/json', 'x-lab-token': state.csrf } });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'shared_batch_busy');
      assert.match(response.json().error, /Live inventory, figures, and interactive models remain available/);
    }
    assert.equal(queue.jobs.length, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/demos/bernoulliEntropyFig', headers: { host } })).statusCode, 200);
    assert.equal(await readFile(path.join(dir, '.runner.lock'), 'utf8'), lock);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a batch acquiring its lock after submission prevents queued work from spawning', async t => {
  if (!detectRuntime().python || !detectRuntime().octave) return t.skip('Runtime-dependent queue admission requires provisioned runtimes');
  await mkdir(stateRoot, { recursive: true });
  const dir = await mkdtemp(path.join(stateRoot, 'batch-race-'));
  const demo = await new InventoryStore().entry('bernoulliEntropyFig');
  class BatchStartsDuringPreparation extends InventoryStore {
    override async entry(id: string) {
      await writeFile(path.join(dir, '.runner.lock'), JSON.stringify({ pid: process.pid }));
      return super.entry(id);
    }
  }
  const queue = new RunQueue(new BatchStartsDuringPreparation(), path.join(dir, 'state'), dir);
  try {
    await queue.init();
    const job = await queue.enqueue(demo);
    const deadline = Date.now() + 10_000;
    while (!job.finishedAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(job.status, 'busy');
    assert.match(job.message!, /Shared batch busy/);
    assert.equal(job.startedAt, undefined);
    assert.equal(job.exitCode, undefined);
    assert.equal(job.output, '');
    assert.ok(job.finishedAt);
  } finally { await queue.shutdown(); await rm(dir, { recursive: true, force: true }); }
});
