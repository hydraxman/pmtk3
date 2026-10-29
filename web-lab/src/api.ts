import type { DemoDetail, Snapshot } from '../shared/contracts';
export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}
export async function mutate(url: string, body: object, csrf: string) {
  const response = await fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Lab-Token': csrf,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
export const loadState = (signal?: AbortSignal) => getJSON<Snapshot>('/api/state', signal);
export const loadDetail = (id: string, signal?: AbortSignal) => getJSON<DemoDetail>(`/api/demos/${encodeURIComponent(id)}`, signal);
