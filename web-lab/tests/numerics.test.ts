import test from 'node:test';
import assert from 'node:assert/strict';
import { betaBernoulli, betaDensity, emDemo, gaussianEM, hmmForwardBackward, linearFit, logSumExp, numericalFixtures,
  parityFixtures, pca2, seededRandom, sprinkler, sum, symmetricEigen2 } from '../shared/numerics.js';

function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
}
test('seeded generator is reproducible with a known uint32 fixture', () => {
  const rng = seededRandom(42), same = seededRandom(42), other = seededRandom(43);
  const values = Array.from({ length: 10 }, rng);
  assert.deepEqual(values, Array.from({ length: 10 }, same));
  assert.notDeepEqual(values, Array.from({ length: 10 }, other));
  near(values[0], .6011037519201636);
  assert.ok(values.every(x => x >= 0 && x < 1));
});
test('Beta conjugate update, analytic mean, variance and evidence', () => {
  const posterior = betaBernoulli(2, 3, 4, 1);
  near(posterior.alpha, 6);
  near(posterior.beta, 4);
  near(posterior.mean, .6);
  near(posterior.variance, 24 / 1100);
  near(posterior.predictive, .6);
  near(betaBernoulli(1, 1, 1, 0).logEvidence, Math.log(.5));
  const uniform = betaBernoulli(1, 1, 0, 0);
  uniform.prior.forEach(v => near(v, 1));
  const dense = betaBernoulli(2, 2, 7, 3);
  near(sum(dense.posterior) / dense.posterior.length, 1, 1e-7);
  assert.throws(() => betaBernoulli(0, 1), RangeError);
});
test('log-sum-exp remains stable in the extreme tails', () => {
  near(logSumExp([-1000, -1000]), -1000 + Math.log(2));
  assert.equal(logSumExp([-Infinity, -Infinity]), -Infinity);
});
test('ordinary least squares recovers an exact intercept and slope', () => {
  const fit = linearFit([[1, -2], [1, -1], [1, 0], [1, 1], [1, 2]], [-3, -1, 1, 3, 5]);
  near(fit.coefficients[0], 1); near(fit.coefficients[1], 2); near(fit.sse, 0);
  assert.throws(() => linearFit([[1, 1], [1, 1]], [1, 1]), /Rank-deficient/);
});
test('ridge slope is analytically shrunk, but intercept is never penalized', () => {
  const fit = linearFit([[1, -1], [1, 0], [1, 1]], [8, 10, 12], 2);
  near(fit.coefficients[0], 10);
  near(fit.coefficients[1], 1);
  const intercept = linearFit([[1], [1]], [12, 12], 1e8);
  near(intercept.coefficients[0], 12);
});
test('symmetric 2D eigendecomposition has orthonormal eigenvectors and small residuals', () => {
  for (const [a, b, d] of [[3, 2, 4], [4, 0, 1], [1, 0, 4], [2, 0, 2], [1, -2, 7]]) {
    const eig = symmetricEigen2(a, b, d);
    assert.ok(eig.values[0] >= eig.values[1]);
    eig.vectors.forEach((v, k) => {
      near(v[0] ** 2 + v[1] ** 2, 1);
      near(a * v[0] + b * v[1], eig.values[k] * v[0]);
      near(b * v[0] + d * v[1], eig.values[k] * v[1]);
    });
    near(sum(eig.vectors[0].map((v, j) => v * eig.vectors[1][j])), 0);
  }
});
test('PCA sample covariance is explicit; default population normalization changes only eigenvalue scale', () => {
  const data = [[-1, -2], [0, 0], [1, 2]], fit = pca2(data, 'sample'), population = pca2(data);
  near(fit.eigenvalues[0], 5); near(fit.eigenvalues[1], 0); near(fit.explained, 1);
  near(population.eigenvalues[0], 10 / 3);
  assert.equal(population.covarianceConvention, 'population');
  assert.equal(population.covarianceDivisor, data.length);
  assert.equal(fit.covarianceDivisor, data.length - 1);
  fit.eigenvectors.forEach((v, i) => v.forEach((value, j) => near(value, population.eigenvectors[i][j])));
  data.forEach((p, i) => p.forEach((v, j) => near(fit.reconstructed[i][j], v)));
});
test('Gaussian EM maintains normalized responsibilities and monotonic observed likelihood', () => {
  for (const separation of [.5, 2, 4, 6]) {
    const fit = emDemo(42, separation, 50);
    near(sum(fit.weights), 1);
    fit.responsibilities.forEach(row => near(sum(row), 1));
    fit.history.slice(1).forEach((row, i) => assert.ok(row.likelihood >= fit.history[i].likelihood - 1e-8));
    assert.ok(fit.variances.every(v => v >= 1e-6));
    if (separation >= 4) {
      near(fit.means[0], -separation / 2, .4);
      near(fit.means[1], separation / 2, .4);
    }
  }
  const degenerate = gaussianEM([1, 1, 1, 1], 2, 3);
  assert.ok(Number.isFinite(degenerate.likelihood));
});
test('HMM forward-backward and Viterbi agree with exhaustive enumeration of a tiny fixture', () => {
  const pi = [.6, .4], a = [[.7, .3], [.2, .8]], b = [[.9, .1], [.25, .75]], obs = [0, 1, 0, 1];
  const fit = hmmForwardBackward(pi, a, b, obs);
  const paths = Array.from({ length: 2 ** obs.length }, (_, code) => {
    const states = obs.map((_, t) => code >> t & 1);
    let probability = pi[states[0]] * b[states[0]][obs[0]];
    for (let t = 1; t < obs.length; t++) probability *= a[states[t - 1]][states[t]] * b[states[t]][obs[t]];
    return { states, probability };
  });
  const total = sum(paths.map(p => p.probability));
  near(fit.logLikelihood, Math.log(total));
  fit.marginals.forEach((row, t) => row.forEach((v, s) => near(v,
    sum(paths.filter(p => p.states[t] === s).map(p => p.probability)) / total)));
  fit.expectedTransitions.forEach((row, i) => row.forEach((v, j) => {
    const expected = sum(paths.map(p => p.probability * p.states.slice(1).filter((s, t) => p.states[t] === i && s === j).length)) / total;
    near(v, expected);
  }));
  assert.deepEqual(fit.viterbi, paths.sort((x, y) => y.probability - x.probability)[0].states);
});
test('HMM log space survives long unlikely sequences and rejects impossible evidence', () => {
  const fit = hmmForwardBackward([1, 0], [[.9, .1], [.2, .8]], [[1e-6, 1 - 1e-6], [1e-6, 1 - 1e-6]], Array(1000).fill(0));
  near(fit.logLikelihood, 1000 * Math.log(1e-6), 1e-6);
  fit.marginals.forEach(row => near(sum(row), 1));
  assert.throws(() => hmmForwardBackward([1], [[1]], [[1, 0]], [1]), /zero probability/);
});
test('sprinkler exact joint normalization, known wet-grass probability and explaining away', () => {
  const fit = sprinkler({ wet: true });
  near(sum(fit.states.map(s => s.probability)), 1);
  near(fit.evidenceProbability, .6471);
  near(fit.posterior.rain, .4581 / .6471);
  near(fit.posterior.wet, 1);
  assert.ok(sprinkler({ wet: true, sprinkler: true }).posterior.rain < fit.posterior.rain);
  assert.throws(() => sprinkler({ wet: true, sprinkler: false, rain: false }), /zero probability/);
});
test('default cross-engine fixtures are deterministic and finite', () => {
  const first = numericalFixtures(), second = numericalFixtures();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(!JSON.stringify(first).includes('null')); // No NaN/Infinity serialized as null.
});
test('supplied fixed Beta and regression fixtures match analytical values', () => {
  const fixture = parityFixtures();
  assert.deepEqual(fixture.beta.prior, [.5, .5]);
  assert.deepEqual(fixture.beta.posterior, [4.5, 2.5]);
  near(fixture.beta.mean, 4.5 / 7);
  fixture.regression.ols.forEach((v, j) => near(v, [1, 1.98][j]));
  fixture.regression.ridge.forEach((v, j) => near(v, [1, 1.65][j]));
  near(betaDensity(0, 1, 2), 2);
  near(betaDensity(1, 2, 1), 2);
});
test('supplied PCA fixture matches cov(X,1) and has a sign-invariant rank-one projector', () => {
  const fixture = parityFixtures().pca;
  near(fixture.eigenvalues[0], 2.5); near(fixture.eigenvalues[1], 0);
  const expected = [[.8, .4], [.4, .2]];
  fixture.projector.forEach((row, i) => row.forEach((v, j) => near(v, expected[i][j])));
  fixture.reconstruction.forEach((row, i) => row.forEach((v, j) => near(v, fixture.points[i][j])));
});
test('supplied HMM fixture uses row transitions and zero-based observations; gamma is state by time', () => {
  const fixture = parityFixtures().hmm;
  assert.deepEqual(fixture.observationsZeroBased, [0, 1, 0]);
  assert.equal(fixture.gamma.length, 2);
  assert.ok(fixture.gamma.every(row => row.length === 3));
  near(fixture.logLikelihood, Math.log(.069616));
  for (let t = 0; t < 3; t++) {
    near(sum(fixture.gamma.map(row => row[t])), 1);
    for (let s = 0; s < 2; s++) near(fixture.gamma[s][t], fixture.marginals[t][s]);
  }
  assert.deepEqual(fixture.viterbi, [0, 0, 0]);
});
test('explicit mixture initialization produces deterministic monotonic fixed-input output', () => {
  const fixture = parityFixtures().mixture;
  assert.deepEqual(fixture.initial.mu, [-2, 2]);
  assert.equal(fixture.training.maxIter, 25);
  assert.equal(fixture.training.convTol, 1e-10);
  assert.equal(fixture.training.converged, true);
  assert.equal(fixture.training.iterationsUsed, 3);
  fixture.means.forEach((v, k) => near(v, [-2.25, 2.25][k], 1e-8));
  fixture.logLikelihoodHistory.slice(1).forEach((value, k) => assert.ok(value >= fixture.logLikelihoodHistory[k] - 1e-10));
  assert.throws(() => gaussianEM([-1, 1], 2, 1, { means: [0, 1], variances: [0, 1], weights: [.5, .5] }), /Invalid initial/);
});
