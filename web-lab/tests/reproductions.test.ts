import test from 'node:test';
import assert from 'node:assert/strict';
import { reproductionIds } from '../shared/reproductions/manifest.js';
import { reproductions, runReproduction, validateExperiment } from '../shared/reproductions/index.js';
import { cholesky, dot, solve, symmetricEigen } from '../shared/reproductions/math.js';
import { renderPlotSvg } from '../scripts/reproduction-svg.js';

test('reviewed reproduction registry contains each of the 52 unresolved source cases exactly once', () => {
  assert.equal(reproductions.length, 52);
  assert.deepEqual(reproductions.map(item => item.id).sort(), [...reproductionIds].sort());
  for (const item of reproductions) {
    assert.equal(item.source, `demos/${item.id}.m`);
    assert.ok(item.differences.length && item.description && item.method);
  }
});
test('shared numerical primitives match independent linear algebra fixtures', () => {
  assert.deepEqual(solve([[2, 1], [1, 3]], [5, 5]), [2, 1]);
  const matrix = [[4, 1, .5], [1, 3, -.25], [.5, -.25, 2]], eigen = symmetricEigen(matrix);
  for (let k = 0; k < 3; k++) {
    const v = eigen.vectors[k], lambda = eigen.values[k];
    assert.ok(Math.max(...matrix.map((row, i) => Math.abs(dot(row, v) - lambda * v[i]))) < 1e-8);
    assert.ok(Math.abs(dot(v, v) - 1) < 1e-10);
  }
  const lower = cholesky(matrix);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(dot(lower[i], lower[j]) - matrix[i][j]) < 1e-10);
  assert.throws(() => solve([[0]], [1]), /Singular/);
});
for (const definition of reproductions) test(`${definition.id}: real finite plots, deterministic computation and numerical assertions`, () => {
  for (const seed of [0, 42, 2026]) {
    const run = runReproduction(definition.id, seed);
    assert.equal(run.originalExecuted, false);
    assert.equal(run.engine, 'independent-typescript');
    assert.deepEqual(run.result, runReproduction(definition.id, seed).result);
    for (const plot of run.result.plots) {
      const svg = renderPlotSvg(plot);
      assert.match(svg, /^<svg/);
      assert.doesNotMatch(svg, /\bNaN\b|\bInfinity\b|<script/);
      assert.match(svg, /Fresh independent TypeScript computation/);
    }
  }
});
test('reproductions reject unknown identity, invalid seeds and success-shaped invalid output', () => {
  assert.throws(() => runReproduction('unknown'), /Unknown/);
  for (const seed of [-1, 2 ** 32, .5, NaN, Infinity]) assert.throws(() => runReproduction('arsDemo', seed), /Seed/);
  assert.throws(() => validateExperiment({ plots: [], checks: [], metrics: {} }), /plots/);
  assert.throws(() => validateExperiment({
    plots: [{ title: 'Bad', traces: [{ name: 'Bad', type: 'scatter', x: [1], y: [NaN] }] }],
    checks: [{ name: 'bad', passed: true }], metrics: {},
  }), /Invalid/);
});
