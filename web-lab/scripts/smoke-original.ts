import assert from 'node:assert/strict';
import type { DemoDetail, Job, Snapshot } from '../shared/contracts.js';
import { webRunLimits } from '../shared/execution.js';

const base = `http://127.0.0.1:${process.env.WEB_LAB_PORT ?? 4173}`;
const demoId = process.argv[2] ?? 'bernoulliEntropyFig';
async function get<T>(url: string): Promise<T> {
  const response = await fetch(`${base}${url}`, { signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `GET ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}
const initial = await get<Snapshot>('/api/state');
assert.ok(!initial.sharedRunner.active, 'Shared batch busy: defer original execution until the parent batch releases its lock.');
assert.ok(initial.runtime.python && initial.runtime.octave, 'Provision Python and Octave before this optional smoke');
async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(`${base}${url}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Lab-Token': initial.csrf, Origin: base,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`);
  return result as T;
}
async function finished(id: string) {
  const deadline = Date.now() + (webRunLimits.serviceWatchdogSeconds + 30) * 1000;
  while (Date.now() < deadline) {
    const state = await get<Snapshot>('/api/state'), job = state.jobs.find(j => j.id === id);
    if (job && !['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('Smoke deadline exceeded');
}
const run = await post<Job>('/api/runs', { demoId });
const result = await finished(run.id);
assert.equal(result.status, 'success', result.output);
const detail = await get<DemoDetail>(`/api/demos/${encodeURIComponent(demoId)}`);
const attempt = detail.attempts.find(a => a.label.startsWith('Web lab'))!;
assert.equal(attempt.result.status, 'success');
for (const image of attempt.figures) {
  const response = await fetch(`${base}${image.url}`);
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
console.log(JSON.stringify({ passed: true, jobId: result.id, demoId, attempt: attempt.result.attempt_id,
  duration: attempt.result.duration_seconds, figures: attempt.figures.length }, null, 2));
