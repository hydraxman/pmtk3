import test from 'node:test';
import assert from 'node:assert/strict';
import { parityFixtures } from '../shared/numerics.js';
import { sharedRoot } from '../server/config.js';
import { jsonFile } from '../server/files.js';
import { checkNumericalParity, type OriginalNumericalReference } from '../shared/parity.js';

async function reference() {
  try { return await jsonFile<OriginalNumericalReference>(sharedRoot, 'numerical-reference.json'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function close(a: number, b: number, tolerance = 1e-9) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance,
    `${a} differs from original reference ${b} by more than ${tolerance}`);
}
test('published original fixed Beta/regression/PCA reference matches, with PCA signs factored out', async t => {
  const original = await reference();
  if (!original) return t.skip('Parent numerical-reference.json is not yet available');
  const actual = parityFixtures();
  assert.deepEqual(actual.beta.prior, original.beta.prior);
  assert.deepEqual(actual.beta.observations, original.beta.observations);
  actual.beta.posterior.forEach((v, i) => close(v, original.beta.posterior[i]));
  actual.beta.density.forEach((v, i) => close(v, original.beta.density[i]));
  close(actual.beta.mean, original.beta.mean);
  assert.deepEqual(actual.regression.x, original.regression.x);
  assert.deepEqual(actual.regression.y, original.regression.y);
  close(actual.regression.ridgeLambda, original.regression.ridgeLambda);
  actual.regression.ols.forEach((v, i) => close(v, original.regression.ols[i]));
  actual.regression.ridge.forEach((v, i) => close(v, original.regression.ridge[i]));
  assert.deepEqual(actual.pca.points, original.pca.points);
  assert.match(original.pca.covarianceConvention, /population/i);
  actual.pca.eigenvalues.forEach((v, i) => close(v, original.pca.eigenvalues[i]));
  actual.pca.projector.forEach((row, i) => row.forEach((v, j) => close(v, original.pca.basis[i] * original.pca.basis[j])));
  actual.pca.reconstruction.forEach((row, i) => row.forEach((v, j) => close(v, original.pca.reconstruction[i][j])));
});
test('original hmmFwdBack gamma and log-likelihood match at 1e-12 for the supplied strong fixture', async t => {
  const original = await reference();
  if (!original) return t.skip('Parent numerical-reference.json is not yet available');
  const actual = parityFixtures().hmm, expected = original.hmm;
  assert.deepEqual(actual.initial, expected.initial);
  assert.deepEqual(actual.transition, expected.transition);
  assert.deepEqual(actual.emission, expected.emission);
  assert.deepEqual(actual.observationsZeroBased, expected.observationsZeroBased);
  assert.equal(expected.gamma.length, 2);
  assert.ok(expected.gamma.every(row => row.length === 3));
  close(actual.logLikelihood, expected.logLikelihood, 1e-12);
  for (let state = 0; state < 2; state++) for (let time = 0; time < 3; time++) {
    close(actual.gamma[state][time], expected.gamma[state][time], 1e-12);
    close(actual.marginals[time][state], expected.gamma[state][time], 1e-12);
  }
});
test('all six independent TS adapters match the persisted original fixed-fixture oracle', async t => {
  const original = await reference();
  if (!original) return t.skip('Parent numerical-reference.json is not yet available');
  const report = checkNumericalParity(original);
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(report.checksPassed, 6);
  assert.ok(report.models.every(model => model.maxAbsoluteError <= model.absoluteTolerance));
});
test('published original sprinkler and initialized EM reference match on identical fixed inputs', async t => {
  const original = await reference();
  if (!original) return t.skip('Parent numerical-reference.json is not yet available');
  const actual = parityFixtures();
  close(actual.sprinkler.wet, original.sprinkler.wet);
  close(actual.sprinkler.rainGivenWet, original.sprinkler.rainGivenWet);
  assert.deepEqual(actual.mixture.data, original.mixture.data);
  assert.deepEqual(actual.mixture.initial, original.mixture.initial);
  actual.mixture.means.forEach((v, i) => close(v, original.mixture.means[i]));
  actual.mixture.variances.forEach((v, i) => close(v, original.mixture.variances[i]));
  actual.mixture.weights.forEach((v, i) => close(v, original.mixture.weights[i]));
  assert.equal(actual.mixture.logLikelihoodHistory.length, original.mixture.logLikelihoodHistory.length);
  actual.mixture.logLikelihoodHistory.forEach((v, i) => close(v, original.mixture.logLikelihoodHistory[i]));
});
