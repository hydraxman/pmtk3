import type { Demo, DemoResult, EngineConstraint, HistoricalAlias, Job } from './contracts.js';

export const sharedBatchBusyMessage = 'Shared batch busy: web execution is paused until the parent batch lock is released. Live inventory, figures, and interactive models remain available.';

export function staticOctaveUnsupported(demo: Demo): EngineConstraint | undefined {
  return demo.engine_constraints?.find(c => c.engine.toLowerCase() === 'octave' && c.status === 'unsupported');
}
export function eligibleToAttempt(demo: Demo) {
  return !!demo.source && demo.runnable && !demo.safety.length && !staticOctaveUnsupported(demo);
}
export function octaveUnsupported(demo: Demo, result: DemoResult = demo.result): EngineConstraint | undefined {
  const declared = staticOctaveUnsupported(demo);
  if (declared) return declared;
  const skippedSuccess = result?.status === 'success' &&
    (result.workload_executed === false || result.execution_disposition === 'not_executed');
  if (result?.status === 'unsupported' || demo.result?.status === 'unsupported' || skippedSuccess) {
    const classification = result?.status === 'unsupported' ? result : demo.result?.status === 'unsupported' ? demo.result : undefined;
    return { engine: 'octave', status: 'unsupported', requirement: classification?.requirement ?? result?.requirement ?? 'Supported Octave workload',
      reason: classification?.message ?? 'The demo workload was not executed; a clean exit alone is not a pass.' };
  }
}
export function canRunInOctave(demo: Demo) {
  return !!demo.source && demo.runnable && !demo.safety.length && !octaveUnsupported(demo);
}
export function executedSuccess(result: DemoResult) {
  return result.status === 'success' && result.success && result.workload_executed !== false &&
    result.execution_disposition !== 'not_executed';
}
export function executionStatus(demo: Demo) {
  return octaveUnsupported(demo) ? 'unsupported' : demo.result.status;
}
export function demoExecutedSuccess(demo: Demo) {
  return !octaveUnsupported(demo) && executedSuccess(demo.result);
}
export function jobForDisplay(job: Job, demo?: Demo): Job {
  const unsupported = demo && octaveUnsupported(demo);
  return unsupported && job.status === 'success' ? { ...job, originalStatus: job.status, status: 'unsupported',
    message: `${unsupported.reason} The stored job exit status is not an executed Octave pass.` } : job;
}

export function historicalAliases(demo: Demo): HistoricalAlias[] {
  const aliases = [...(demo.historical_aliases ?? []),
    ...demo.published.flatMap(p => p.historical_alias ? [p.historical_alias] : [])];
  return [...new Map(aliases.filter(a => typeof a.published_stem === 'string')
    .map(a => [a.published_stem, a])).values()];
}
export function demoSearchText(demo: Demo) {
  return [demo.name, demo.description, demo.source ?? '', ...demo.chapters,
    ...demo.tags.map(t => `${t.name} ${t.value}`),
    ...demo.published.flatMap(p => [p.page, p.published_stem ?? '']),
    ...(demo.engine_constraints ?? []).flatMap(c => [c.engine, c.status, c.requirement, c.reason]),
    ...historicalAliases(demo).flatMap(a => [a.published_stem, a.old_source])]
    .join(' ').toLowerCase();
}
export function inventoryMetrics(entries: Demo[], counts: Record<string, number>) {
  const published = new Set(entries.flatMap(e => e.published.map(p =>
    p.published_stem ?? p.page.split('/').at(-1)?.replace(/\.html$/i, '') ?? p.page)));
  const mapped = new Set(entries.filter(e => e.source).flatMap(e => e.published.map(p =>
    p.published_stem ?? p.page.split('/').at(-1)?.replace(/\.html$/i, '') ?? p.page)));
  const renames = new Set(entries.flatMap(e => historicalAliases(e).map(a => a.published_stem)));
  return {
    sources: counts.m_files ?? entries.filter(e => e.source).length,
    // Static policy only. Runtime dependency failures must not rewrite this count.
    runnable: entries.filter(eligibleToAttempt).length,
    blocked: counts.blocked_candidates ?? entries.filter(e => e.safety.length).length,
    unsupported: entries.filter(e => staticOctaveUnsupported(e)).length,
    published: counts.unique_published_demo_stems ?? published.size,
    mapped: counts.source_matched_unique ?? mapped.size,
    renames: counts.historical_alias_unique ?? renames.size,
  };
}
