import assert from 'node:assert/strict';
import type { DemoDetail, DemoResult, Job, Snapshot } from '../shared/contracts.js';
import { webRunLimits } from '../shared/execution.js';

const base = `http://127.0.0.1:${process.env.WEB_LAB_PORT ?? 4173}`;
const demoId = 'bernoulliEntropyFig', queuedDemoId = 'betaPlotDemo';
const owned = new Set<string>();
let token = '';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function get<T>(url: string): Promise<T> {
  const response = await fetch(`${base}${url}`, { signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `GET ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}
function post(url: string, body: object) {
  return fetch(`${base}${url}`, { method: 'POST', headers: {
    Origin: base, 'Content-Type': 'application/json', 'X-Lab-Token': token,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
}
async function checkedPost<T>(url: string, body: object): Promise<T> {
  const response = await post(url, body), data = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`);
  return data as T;
}
function alive(pid: number) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  try { process.kill(pid, 0); return true; } // Detection only. Termination is always through the owned-job API.
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
async function freshRunningAttempt(job: Job): Promise<DemoResult> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = await get<DemoDetail>(`/api/demos/${demoId}`);
    const attempt = detail.attempts.find(a => a.label.startsWith('Web lab'))?.result;
    if (attempt?.status === 'running' && attempt.pid && attempt.runner_pid &&
      Date.parse(attempt.started_at!) >= Date.parse(job.createdAt)) return attempt;
    const state = await get<Snapshot>('/api/state'), current = state.jobs.find(j => j.id === job.id);
    if (current && !['queued', 'running'].includes(current.status)) throw new Error(`Runner ended before cancellation probe: ${JSON.stringify(current)}`);
    await sleep(500);
  }
  throw new Error('No fresh owned Octave PID appeared within 60 seconds');
}
async function finished(id: string) {
  const deadline = Date.now() + (webRunLimits.serviceWatchdogSeconds + 30) * 1000;
  while (Date.now() < deadline) {
    const state = await get<Snapshot>('/api/state'), job = state.jobs.find(j => j.id === id);
    assert.ok(state.jobs.filter(j => j.status === 'running').length <= 1, 'Only one user job may execute');
    if (job && !['queued', 'running'].includes(job.status)) return job;
    await sleep(1500);
  }
  throw new Error('Owned job exceeded the bounded smoke deadline');
}
try {
  const initial = await get<Snapshot>('/api/state');
  token = initial.csrf;
  assert.ok(!initial.sharedRunner.active, 'Shared batch busy: defer queue integration until the parent batch releases its lock. No original was submitted.');
  assert.ok(initial.runtime.python && initial.runtime.octave, 'Provision Python/Octave before the queue integration test');
  assert.ok(!initial.jobs.some(j => ['queued', 'running'].includes(j.status)),
    'Wait for existing user jobs before this test; it will never cancel work it did not submit');
  for (const id of [demoId, queuedDemoId]) {
    const demo = initial.entries.find(e => e.id === id);
    assert.ok(demo?.runnable && !demo.safety.length, `Expected safe runnable fixture: ${id}`);
  }
  const responses = await Promise.all([post('/api/runs', { demoId }), post('/api/runs', { demoId })]);
  // Capture accepted IDs before asserting, so even a regression is cleaned up safely.
  const submitted: Job[] = [];
  for (const response of responses) if (response.status === 202) {
    const job = await response.json() as Job;
    submitted.push(job); owned.add(job.id);
  }
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 409], 'Concurrent duplicate submission must be rejected');
  const first = submitted[0];
  const queued = await checkedPost<Job>('/api/runs', { demoId: queuedDemoId });
  owned.add(queued.id);
  const queueState = await get<Snapshot>('/api/state');
  assert.equal(queueState.jobs.find(j => j.id === queued.id)?.status, 'queued', 'Second user job must wait');
  assert.ok(queueState.jobs.filter(j => j.status === 'running').length <= 1);
  assert.equal((await checkedPost<Job>(`/api/runs/${queued.id}/cancel`, {})).status, 'cancelled');

  const running = await freshRunningAttempt(first);
  assert.equal((await checkedPost<Job>(`/api/runs/${first.id}/cancel`, {})).status, 'cancelled');
  const reapDeadline = Date.now() + 15_000;
  while ((alive(running.runner_pid!) || alive(running.pid!)) && Date.now() < reapDeadline) await sleep(250);
  assert.equal(alive(running.runner_pid!), false, 'Owned Python must terminate');
  assert.equal(alive(running.pid!), false, 'Owned Octave must terminate with its Python Job Object');

  const retry = await checkedPost<Job>('/api/runs', { demoId });
  owned.add(retry.id);
  const result = await finished(retry.id);
  assert.equal(result.status, 'success', result.output);
  const detail = await get<DemoDetail>(`/api/demos/${demoId}`);
  const attempt = detail.attempts.find(a => a.label.startsWith('Web lab'))!;
  assert.equal(attempt.result.status, 'success');
  assert.notEqual(attempt.result.attempt_id, running.attempt_id);
  assert.ok(Date.parse(attempt.result.started_at!) >= Date.parse(retry.createdAt));
  assert.ok(attempt.figures.length > 0, 'This visual original must produce real figures');
  for (const image of attempt.figures) {
    const response = await fetch(`${base}${image.url}`), bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.ok(bytes.length > 1000);
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  console.log(JSON.stringify({ passed: true, scope: 'Owned queue lifecycle and one real original demo, not all original cases',
    duplicateResponses: responses.map(r => r.status), serialized: true, queuedCancellation: true, runningCancellation: true,
    ownedPythonTerminated: !alive(running.runner_pid!), ownedOctaveTerminated: !alive(running.pid!),
    retryJob: retry.id, freshAttempt: attempt.result.attempt_id, figures: attempt.figures.length }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Never kill by stored PID, image name, or someone else's job ID.
  try {
    const state = await get<Snapshot>('/api/state');
    for (const job of state.jobs) if (owned.has(job.id) && ['queued', 'running'].includes(job.status)) {
      await checkedPost(`/api/runs/${job.id}/cancel`, {});
    }
  } catch { /* Service shutdown already closes its owned process handle. */ }
}
