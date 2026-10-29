import { numericalReproductions } from './numerical.js';
import { statisticalReproductions } from './statistical.js';
import { classificationReproductions } from './classification.js';
import { graphicalReproductions } from './graphical.js';
import { reproductionIds } from './manifest.js';
import type { ExperimentResult, Reproduction } from './types.js';
export const reproductions: Reproduction[] = [
  ...numericalReproductions, ...statisticalReproductions,
  ...classificationReproductions, ...graphicalReproductions,
].sort((a, b) => a.id.localeCompare(b.id));
const registry = new Map(reproductions.map(definition => [definition.id, definition]));
if (registry.size !== reproductionIds.length || reproductions.length !== registry.size ||
    reproductionIds.some(id => !registry.has(id))) {
  throw new Error('Visual reproduction registry does not match the reviewed 52-case manifest');
}
export function reproductionMetadata() {
  return reproductions.map(({ run: _run, ...metadata }) => metadata);
}
export function validateExperiment(result: ExperimentResult) {
  if (!result.plots.length || !result.checks.length) throw new Error('Experiment must provide plots and numerical checks');
  for (const [name, value] of Object.entries(result.metrics)) {
    if (typeof value !== 'string' && !Number.isFinite(value)) throw new Error(`Nonfinite experiment metric: ${name}`);
  }
  for (const plot of result.plots) {
    if (!plot.title || !plot.traces.length) throw new Error('Empty experiment plot');
    for (const trace of plot.traces) {
      if (!['scatter', 'bar'].includes(trace.type) || !trace.x.length || trace.x.length !== trace.y.length ||
          !trace.y.every(Number.isFinite) || trace.x.some(v => typeof v !== 'string' && !Number.isFinite(v))) {
        throw new Error(`Invalid plot trace: ${plot.title} / ${trace.name}`);
      }
      if (Array.isArray(trace.marker?.color) &&
          (trace.marker.color.length !== trace.y.length || !trace.marker.color.every(Number.isFinite))) {
        throw new Error(`Invalid plot colors: ${plot.title}`);
      }
    }
  }
  const failed = result.checks.filter(check => !check.passed);
  if (failed.length) throw new Error(`Numerical experiment checks failed: ${failed.map(check => check.name).join('; ')}`);
}
export function runReproduction(id: string, seed = 42) {
  const definition = registry.get(id);
  if (!definition) throw new RangeError('Unknown visual reproduction ID');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer');
  const started = performance.now(), result = definition.run(seed);
  validateExperiment(result);
  const { run: _run, ...metadata } = definition;
  return {
    ...metadata, engine: 'independent-typescript' as const, originalExecuted: false as const,
    seed, durationMs: performance.now() - started, result,
    scope: 'Educational reproduction with disclosed changes; not a successful execution of the original MATLAB workload.',
  };
}
export type ReproductionRun = ReturnType<typeof runReproduction>;
