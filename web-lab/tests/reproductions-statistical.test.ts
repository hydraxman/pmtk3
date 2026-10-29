import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  statisticalReproductions, statisticalPca, maximumLikelihoodFA,
  statisticalLasso, statisticalScad, scadPenalty, scadDerivative, studentTRegressionEM,
  categoricalPosterior, categoricalPredict, fitCategoricalMixture, logisticMatrixFactorization,
  poissonGPLaplace, averageLinkage, statisticalKmeans, adjustedRand, mixedKnnImpute,
  lowRankImpute, bernoulliBicluster, fitTaskShrinkage,
} from '../shared/reproductions/statistical.js';
import type { ExperimentResult } from '../shared/reproductions/types.js';

const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const mean = (x: number[]) => sum(x) / x.length;
const dot = (a: number[], b: number[]) => sum(a.map((v, j) => v * b[j]));
function near(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} ± ${tolerance}`);
}
function monotonic(values: number[], increasing: boolean, tolerance = 1e-6) {
  values.slice(1).forEach((value, i) => assert.ok(
    increasing ? value >= values[i] - tolerance : value <= values[i] + tolerance,
    `Objective moved the wrong way at ${i}: ${values[i]} -> ${value}`));
}

test('population PCA has analytic eigenvalues, orthogonal bases, and exact full reconstruction', () => {
  const data = [[2, 0, 0], [-2, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, .5], [0, 0, -.5]];
  const fit = statisticalPca(data, 2);
  [4 / 3, 1 / 3, 1 / 12].forEach((value, j) => near(fit.values[j], value));
  fit.vectors.forEach((v, i) => fit.vectors.forEach((w, j) => near(dot(v, w), +(i === j))));
  fit.reconstruction(3).forEach((row, i) => row.forEach((v, j) => near(v, data[i][j])));
  near(fit.reconstructed[4][2], 0);
  // Rotated covariance catches a "diagonal-only PCA" implementation.
  const rotated = statisticalPca([[1, 2], [-1, -2], [.4, -.2], [-.4, .2]]);
  assert.ok(Math.abs(rotated.covariance[0][1]) > .5);
  rotated.vectors.forEach((v, k) => rotated.covariance.forEach((row, j) =>
    near(dot(row, v), rotated.values[k] * v[j])));
});

test('ML FA recovers a known non-isotropic factor covariance, likelihood and posterior scores', () => {
  // Four centered orthogonal ±1 columns of an 8-row Hadamard design.
  // X_j = z + sqrt(Psi_j)*epsilon_j, so empirical S = 11' + diag(1,2,4) exactly.
  const data = Array.from({ length: 8 }, (_, i) => {
    const z = i & 1 ? 1 : -1;
    const errors = [i & 2 ? 1 : -1, i & 4 ? 1 : -1, ((i & 1) !== 0) !== ((i & 2) !== 0) ? 1 : -1];
    return [1, 2, 4].map((psi, j) => z + Math.sqrt(psi) * errors[j]);
  });
  const fit = maximumLikelihoodFA(data, 1, 800);
  const expected = [[2, 1, 1], [1, 3, 1], [1, 1, 5]];
  fit.covariance.forEach((row, i) => row.forEach((v, j) => near(v, expected[i][j], 3e-4)));
  [1, 2, 4].forEach((psi, j) => near(fit.uniqueness[j], psi, 5e-4));
  // det(diag(1,2,4)+11')=22, trace(C^-1 S)=3 at the known optimum.
  near(fit.history.at(-1)!, -4 * (3 * Math.log(2 * Math.PI) + Math.log(22) + 3), 1e-6);
  monotonic(fit.history, true);
  data.forEach((row, i) => {
    const numerator = sum(row.map((v, j) => fit.loadings[j][0] * v / fit.uniqueness[j]));
    const denominator = 1 + sum(fit.loadings.map((w, j) => w[0] ** 2 / fit.uniqueness[j]));
    near(fit.scores[i][0], numerator / denominator);
  });
  assert.ok(Math.max(...fit.uniqueness) - Math.min(...fit.uniqueness) > 2.9,
    'A PCA/isotropic-noise substitute must not pass as FA');
});

test('Lasso matches orthogonal soft thresholding and correlated-design KKT conditions', () => {
  const x = [[1, 1], [1, -1], [-1, 1], [-1, -1]], y = x.map(row => 2 * row[0] + .1 * row[1]);
  const fit = statisticalLasso(x, y, [.3, .3]);
  near(fit[0], 1.7); near(fit[1], 0);
  const design = [[1, 2, 1], [2, 1, -1], [-1, 1, 2], [0, -1, 1], [1, 0, -2], [-2, -1, 0]];
  const target = [2, 3, -1, .2, 1, -2], lambda = .2;
  const weights = statisticalLasso(design, target, [.2, .2, .2]);
  weights.forEach((w, j) => {
    const gradient = mean(design.map((row, i) => row[j] * (dot(row, weights) - target[i])));
    if (Math.abs(w) > 1e-7) near(gradient + lambda * Math.sign(w), 0, 1e-7);
    else assert.ok(Math.abs(gradient) <= lambda + 1e-7);
  });
});

test('genuine SCAD has the analytic three penalty regions and non-Lasso scalar solutions', () => {
  const lambda = .5, a = 3.7;
  near(scadPenalty(.2, lambda), .1);
  near(scadPenalty(2.5, lambda), (a + 1) * lambda ** 2 / 2);
  near(scadDerivative(.2, lambda), lambda);
  near(scadDerivative(.8, lambda), (a * lambda - .8) / (a - 1));
  near(scadDerivative(2.5, lambda), 0);
  for (const value of [.2, .8, 2.5, -.8]) {
    const h = 1e-6;
    near((scadPenalty(value + h, lambda) - scadPenalty(value - h, lambda)) / (2 * h),
      Math.sign(value) * scadDerivative(value, lambda), 1e-7);
  }
  const big = statisticalScad([[1], [-1]], [3, -3], lambda);
  near(big.weights[0], 3, 1e-8);
  near(statisticalLasso([[1], [-1]], [3, -3], [lambda])[0], 2.5);
  const middle = statisticalScad([[1], [-1]], [1.3, -1.3], lambda);
  near(middle.weights[0], ((a - 1) * 1.3 - a * lambda) / (a - 2), 1e-5);
  monotonic(big.history, false); monotonic(middle.history, false);
});

test('Gaussian-Gamma Student-t EM shrinks a null effect and decreases the actual posterior objective', () => {
  const fit = studentTRegressionEM([[1, 0], [-1, 0], [0, 1], [0, -1]], [3, -3, .02, -.02], .1, .2, .04);
  monotonic(fit.history, false);
  assert.ok(fit.weights[0] > 2.99 && Math.abs(fit.weights[1]) < .003);
  const nu = .2, s = .04, sigma = .1, y = [3, -3, .02, -.02];
  const x = [[1, 0], [-1, 0], [0, 1], [0, -1]], w = fit.weights;
  // Independent stationary gradient of the integrated Student-t posterior.
  w.forEach((v, j) => {
    const gradient = sum(x.map((row, i) => row[j] * (dot(row, w) - y[i]))) / sigma ** 2 +
      (nu + 1) * v / (nu * s ** 2 + v * v);
    near(gradient, 0, 1e-6);
  });
});

test('categorical mixture exact posterior matches enumeration and omits masked truth', () => {
  const model = { weights: [.6, .4], probabilities: [
    [[.8, .2], [.7, .3]], [[.1, .9], [.2, .8]],
  ] };
  near(Math.exp(categoricalPosterior(model, [1, 0]).logProbability), .156);
  const posterior = categoricalPosterior(model, [1, NaN]);
  near(posterior.responsibilities[0], .25); near(posterior.responsibilities[1], .75);
  near(categoricalPredict(model, [1, NaN])[1][1], .675);
  near(categoricalPredict(model, [NaN, NaN])[1][1], .5);
  const mass = sum([0, 1].flatMap(a => [0, 1].map(b =>
    Math.exp(categoricalPosterior(model, [a, b]).logProbability))));
  near(mass, 1);
  near(categoricalPosterior(model, [NaN, NaN]).logProbability, 0);
});

test('categorical EM fits actual co-occurrence and has normalized parameters', () => {
  const data = [...Array.from({ length: 30 }, () => [0, 0, 1]),
    ...Array.from({ length: 30 }, () => [1, 1, 0]), [0, 1, 1], [1, 0, 0]];
  const model = fitCategoricalMixture(data, 2, 2, 7, 40);
  monotonic(model.history, true, 1e-5);
  near(sum(model.weights), 1);
  model.probabilities.flat().forEach(p => near(sum(p), 1));
  assert.ok(categoricalPredict(model, [0, NaN, 1])[1][0] > .9);
  const mass = sum(Array.from({ length: 8 }, (_, i) =>
    Math.exp(categoricalPosterior(model, [i & 1, (i >> 1) & 1, (i >> 2) & 1]).logProbability)));
  near(mass, 1);
});

test('logistic factorization performs decreasing MAP updates and learns binary dependence', () => {
  const data = Array.from({ length: 40 }, (_, i) => i % 2 ? [1, 1, 0, 0] : [0, 0, 1, 1]);
  const fit = logisticMatrixFactorization(data, 4, 1, 35);
  monotonic(fit.history, false);
  const loss = -mean(data.flatMap((row, i) => row.map((v, j) =>
    Math.log(v ? fit.probabilities[i][j] : 1 - fit.probabilities[i][j]))));
  assert.ok(loss < .12);
  assert.ok(fit.history.at(-1)! < fit.history[0] - 50);
  assert.equal(fit.loadings.length, 4); assert.equal(fit.scores.length, 40);
});

test('Poisson GP Laplace matches a scalar root and analytic curvature, not Gaussian regression', () => {
  const variance = 1.5, exposure = 2, count = 5;
  const fit = poissonGPLaplace([[variance]], [exposure], [count]);
  // Independent bisection of f/v + E exp(f) - y = 0.
  let low = -10, high = 10;
  for (let i = 0; i < 100; i++) {
    const midpoint = (low + high) / 2;
    if (midpoint / variance + exposure * Math.exp(midpoint) > count) high = midpoint;
    else low = midpoint;
  }
  const root = (low + high) / 2;
  near(fit.mode[0], root, 1e-8);
  near(fit.posteriorCovariance[0][0], 1 / (1 / variance + exposure * Math.exp(root)));
  near(fit.gradient[0], 0);
  monotonic(fit.history, false);
  const zero = poissonGPLaplace([[variance]], [exposure], [0]);
  assert.ok(zero.mode[0] < 0);
  assert.ok(zero.posteriorCovariance[0][0] > fit.posteriorCovariance[0][0],
    'Poisson curvature must depend on counts/mode');
});

test('correlated Poisson GP covariance inverts actual posterior Hessian', () => {
  const fit = poissonGPLaplace([[1, .35], [.35, .7]], [2, 6], [0, 9]);
  fit.hessian.forEach((row, i) => [0, 1].forEach(j =>
    near(sum(row.map((v, k) => v * fit.posteriorCovariance[k][j])), +(i === j))));
  fit.gradient.forEach(v => near(v, 0, 1e-7));
});

test('correlation average linkage, k-means and ARI have independent known answers', () => {
  const profiles = [[1, 2, 3], [2, 4, 6], [3, 2, 1], [6, 4, 2]];
  const tree = averageLinkage(profiles, 2);
  near(tree.merges[0].height, 0); near(tree.merges[1].height, 0); near(tree.merges[2].height, 2);
  near(adjustedRand([0, 0, 1, 1], tree.labels), 1);
  near(adjustedRand([0, 0, 1, 1], [0, 1, 0, 1]), -.5);
  const km = statisticalKmeans([[-3], [-2], [2], [3]], 2);
  near(adjustedRand([0, 0, 1, 1], km.labels), 1);
  near(km.history.at(-1)!, 1);
  monotonic(km.history, false);
});

test('mixed kNN uses shared observed cells, donor modes, legal fallbacks, and preserves observations', () => {
  const masked = [[0, 0, NaN], [.1, 1, 2], [4, 2, 0]];
  const one = mixedKnnImpute(masked, [false, true, true], 1);
  near(one[0][2], 2);
  // A categorical mode, NOT a numeric average 1, wins the deterministic 0/2 tie.
  const two = mixedKnnImpute(masked, [false, true, true], 2);
  near(two[0][2], 0);
  masked.forEach((row, i) => row.forEach((v, j) => {
    if (Number.isFinite(v)) near(two[i][j], v);
  }));
  const fallback = mixedKnnImpute([[NaN, NaN], [1, 2], [3, 2]], [false, true], 1);
  near(fallback[0][0], 2); near(fallback[0][1], 2);
});

test('iterative low-rank completion recovers an exact rank-one fixture without changing observed cells', () => {
  const full = [[1, 2, 3], [2, 4, 6], [3, 6, 9], [4, 8, 12], [5, 10, 15]];
  const masked = full.map(row => [...row]); masked[2][1] = NaN; masked[3][2] = NaN;
  const fit = lowRankImpute(masked, 1, 300);
  near(fit.filled[2][1], 6, 1e-4); near(fit.filled[3][2], 12, 1e-4);
  masked.forEach((row, i) => row.forEach((v, j) => {
    if (Number.isFinite(v)) near(fit.filled[i][j], v);
  }));
  monotonic(fit.history, false);
});

test('Bernoulli bicluster recovers known independent membership and increases its variational bound', () => {
  const data = Array.from({ length: 24 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => +(i % 3 === 0 && j % 3 === 0)));
  const fit = bernoulliBicluster(data);
  fit.rows.forEach((p, i) => assert.equal(p > .5, i % 3 === 0));
  fit.columns.forEach((p, j) => assert.equal(p > .5, j % 3 === 0));
  monotonic(fit.history, true);
});

test('task pooling has the analytic Gaussian MAP shrinkage and separate unpenalized intercepts', () => {
  const x = [-1, 0, 1], y = x.map(v => [10 + v, -4 + 3 * v]);
  const fit = fitTaskShrinkage(x, y, 2);
  near(fit.separate[0], 2 / 2.001); near(fit.separate[1], 6 / 2.001);
  near(fit.pooled[0], (2 + 2 * fit.common) / 4);
  near(fit.pooled[1], (6 + 2 * fit.common) / 4);
  near(fit.pooledIntercepts[0], 10); near(fit.pooledIntercepts[1], -4);
  const translated = fitTaskShrinkage(x.map(v => v + 5), y, 2);
  fit.pooled.forEach((w, t) => {
    near(translated.pooled[t], w); near(translated.pooledIntercepts[t], fit.pooledIntercepts[t] - 5 * w);
  });
});

const ids = [
  'biclusterDemo', 'binaryFaDemoNewsgroups', 'bolassoDemo', 'clusterYeast', 'emtShootout',
  'faBiplotDemo', 'imputationGeneMicroarrayDemo', 'imputationMixedAdultDemo',
  'linregSparseEmSynthDemo', 'multitaskRegDemo', 'pcaYeast', 'gpSpatialDemoLaplace',
  'discreteDensityModelsShootout',
];
test('registration owns exactly the 13 assigned IDs and discloses deviations', () => {
  assert.equal(statisticalReproductions.length, 13);
  assert.deepEqual(statisticalReproductions.map(r => r.id).sort(), [...ids].sort());
  statisticalReproductions.forEach(r => {
    assert.equal(r.source, `demos/${r.id}.m`);
    assert.ok(r.title.length > 10 && r.description.length > 20 && r.method.length > 15);
    assert.ok(r.differences.length >= 2 && /synthetic/i.test(r.differences.join(' ')));
  });
});
function assertFiniteResult(result: ExperimentResult) {
  assert.ok(result.plots.length >= 3);
  assert.ok(Object.keys(result.metrics).length >= 3);
  for (const [name, value] of Object.entries(result.metrics)) {
    assert.ok(typeof value === 'string' ? value.length > 0 : Number.isFinite(value), `Invalid metric ${name}`);
  }
  for (const plot of result.plots) {
    assert.ok(plot.title.length > 5 && plot.traces.length > 0);
    for (const trace of plot.traces) {
      assert.ok(trace.type === 'scatter' || trace.type === 'bar');
      assert.ok(trace.x.length > 0 && trace.x.length === trace.y.length);
      assert.ok(trace.x.every(v => typeof v === 'string' || Number.isFinite(v)));
      assert.ok(trace.y.every(Number.isFinite));
      if (Array.isArray(trace.marker?.color)) {
        assert.equal(trace.marker.color.length, trace.x.length);
        assert.ok(trace.marker.color.every(Number.isFinite));
      }
    }
  }
  assert.ok(result.checks.length >= 3);
  for (const check of result.checks) assert.equal(check.passed, true, `${check.name}: ${check.detail ?? ''}`);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length < 500_000, `Unbounded payload: ${serialized.length}`);
}
function assertIndependentResultQuantities(id: string, result: ExperimentResult) {
  const metric = (key: string) => {
    const value = result.metrics[key];
    assert.equal(typeof value, 'number', `Expected numeric metric ${key}`);
    return value as number;
  };
  switch (id) {
    case 'biclusterDemo':
      assert.ok(metric('rowF1') >= .85 && metric('columnF1') >= .85);
      assert.ok(metric('elboGain') > 0);
      break;
    case 'binaryFaDemoNewsgroups':
      assert.equal(metric('rank'), 2);
      assert.ok(metric('factorizedTrainingLogLoss') < metric('independentTrainingLogLoss') - .07);
      assert.ok(metric('objectiveDecrease') > 20);
      break;
    case 'bolassoDemo': {
      assert.equal(metric('bootstraps'), 24);
      assert.ok(metric('bolassoSelected') >= 3 && metric('bolassoSelected') <= 12);
      // Reconstruct strict consensus from the independently serialized frequency plot.
      const frequencies = result.plots[1].traces[0].marker!.color as number[];
      const consensus = result.plots[2].traces[0].marker!.color as number[];
      frequencies.forEach((v, j) => near(consensus[j], +(v === 1)));
      break;
    }
    case 'clusterYeast':
      assert.equal(metric('clusters'), 3);
      assert.ok(metric('averageLinkageARI') > .8 && metric('kmeansARI') > .8);
      assert.equal(result.plots[1].traces.length, 47);
      break;
    case 'emtShootout':
    case 'discreteDensityModelsShootout':
      assert.ok(metric('mixture3TestNLL') < metric('independentTestNLL'));
      assert.ok(metric('mixture3MissingBits') < metric('independentMissingBits'));
      assert.ok(metric('mixture3Brier') >= 0 && metric('mixture3Brier') <= 2);
      assert.ok(metric('maxProbabilityNormalizationError') < 1e-10);
      assert.ok(metric('missingCells') > 100);
      break;
    case 'faBiplotDemo':
      assert.equal(metric('factors'), 2);
      assert.ok(metric('covarianceRMSE') < .08 && metric('minUniqueness') > 0);
      assert.ok(metric('uniquenessRange') > .05 && metric('logLikelihoodGain') > 0);
      break;
    case 'imputationGeneMicroarrayDemo':
      assert.ok(metric('rank2RMSE25pct') < .6 * metric('columnMeanRMSE25pct'));
      assert.ok(metric('knn5RMSE25pct') < metric('columnMeanRMSE25pct'));
      assert.ok(metric('rank2NRMSE25pct') < .4);
      break;
    case 'imputationMixedAdultDemo':
      assert.ok(metric('knn5MixedLoss') < metric('baselineMixedLoss'));
      assert.ok(metric('knn5CategoricalError') >= 0 && metric('knn5CategoricalError') < .5);
      assert.ok(metric('knn5ContinuousRMSE') < 1);
      break;
    case 'linregSparseEmSynthDemo':
      assert.ok(metric('studentTSupportF1') >= .75 && metric('scadSupportF1') >= .75);
      assert.ok(metric('studentTTestMSE') < 1 && metric('scadTestMSE') < 1);
      assert.equal(metric('fixedLambda'), .12);
      break;
    case 'multitaskRegDemo':
      assert.ok(metric('relatedPooledMSE4') < metric('relatedSeparateMSE4'));
      assert.ok(metric('relatedTransferRatio32') < 1);
      assert.ok(metric('heterogeneousTransferRatio32') > 1, 'Controlled heterogeneous fixture exposes negative transfer');
      assert.ok(metric('maxInterceptNormalEquationResidual') < 1e-10);
      break;
    case 'pcaYeast':
      assert.ok(metric('firstTwoExplainedVariance') > .8 && metric('firstTwoExplainedVariance') <= 1);
      assert.ok(metric('fullRankRMSE') < 1e-8 && metric('eigenResidual') < 1e-8);
      break;
    case 'gpSpatialDemoLaplace':
      assert.ok(metric('maxPosteriorGradient') < 1e-6);
      assert.ok(metric('meanLowExposureLogVariance') > metric('meanHighExposureLogVariance'));
      assert.ok(metric('posteriorObjectiveDecrease') > 0 && metric('posteriorRiskRMSE') < .6);
      break;
    default:
      assert.fail(`Missing independent result assertions for ${id}`);
  }
}
for (const reproduction of statisticalReproductions) {
  test(`${reproduction.id}: finite visuals, quantitative checks and deterministic output on multiple seeds`, () => {
    for (const seed of [1, 42, 2026]) {
      const start = performance.now(), result = reproduction.run(seed), elapsed = performance.now() - start;
      assertFiniteResult(result);
      assertIndependentResultQuantities(reproduction.id, result);
      assert.deepEqual(reproduction.run(seed), result, `Seed ${seed} is not deterministic`);
      // Loose CI guard against accidental unbounded workloads; ordinary runs target < 1 second.
      assert.ok(elapsed < 5000, `${reproduction.id} took ${elapsed.toFixed(1)} ms`);
    }
  });
}
