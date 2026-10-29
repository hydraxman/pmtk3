import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { adaptiveRejection, annealPeaks, betaBinomialMass, betaGridHDI, bfgsRosenbrock,
  constrainedRosenbrock, crossCorrelationMatrices, discreteInformation, groupProx, huberFit,
  kernelDensity, logisticFit, metropolisAccept, naturalFisher, naturalGradientPaths, newtonMinimize,
  numericalReproductions, overrelaxedEM, peaksEnergy, rosenbrock, sparseReconstruct } from '../shared/reproductions/numerical.js';
import { dot, mean, norm, range, seededRandom, sum } from '../shared/reproductions/math.js';
import type { ExperimentResult } from '../shared/reproductions/types.js';
import { gaussianEM } from '../shared/numerics.js';

const ids = ['arsDemo', 'demoRosen2d', 'demoRosenHighDim', 'demoRosenConstrained', 'mcAccuracyDemo',
  'mixGaussOverRelaxedEmDemo', 'minFunc_applications', 'natgradDemo', 'simulatedAnnealingDemo2d',
  'powerCurvesDemo', 'miDemo', 'convMatMultDemo', 'groupLassoDemo'];
function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} ± ${tolerance}`);
}
function integrate(x: number[], y: number[]) {
  return sum(y.slice(1).map((v, i) => (v + y[i]) * (x[i + 1] - x[i]) / 2));
}
function validateResult(id: string, result: ExperimentResult) {
  assert.ok(result.plots.length > 0, `${id}: missing plots`);
  assert.ok(Object.keys(result.metrics).length > 0, `${id}: missing metrics`);
  for (const [name, value] of Object.entries(result.metrics)) {
    assert.ok(typeof value === 'string' ? value.length > 0 : Number.isFinite(value), `${id}: nonfinite metric ${name}`);
  }
  assert.ok(result.checks.length >= 3, `${id}: missing mathematical assertions`);
  assert.equal(new Set(result.checks.map(c => c.name)).size, result.checks.length, `${id}: duplicate assertions`);
  for (const c of result.checks) {
    assert.ok(c.name.length > 12 && c.detail && /\d/.test(c.detail), `${id}: assertion needs a quantitative detail`);
    assert.equal(c.passed, true, `${id}: ${c.name}: ${c.detail}`);
  }
  for (const plot of result.plots) {
    assert.ok(plot.title.length > 0 && plot.traces.length > 0, `${id}: empty plot`);
    for (const trace of plot.traces) {
      assert.ok(trace.type === 'scatter' || trace.type === 'bar', `${id}: unsupported Plotly basic trace`);
      assert.ok(trace.name && trace.x.length > 0, `${id}: empty trace`);
      assert.equal(trace.x.length, trace.y.length, `${id}: inconsistent trace shape`);
      assert.ok(trace.y.every(Number.isFinite), `${id}: nonfinite trace y`);
      assert.ok(trace.x.every(v => typeof v === 'string' ? v.length > 0 : Number.isFinite(v)), `${id}: invalid trace x`);
      if (Array.isArray(trace.marker?.color)) {
        assert.equal(trace.marker.color.length, trace.x.length, `${id}: wrong marker color shape`);
        assert.ok(trace.marker.color.every(Number.isFinite), `${id}: nonfinite matrix colors`);
      }
    }
  }
  assert.doesNotThrow(() => JSON.stringify(result));
}

test('registry owns exactly the thirteen requested IDs and explicitly identifies independent implementations', () => {
  assert.deepEqual(numericalReproductions.map(r => r.id), ids);
  assert.equal(new Set(numericalReproductions.map(r => r.id)).size, 13);
  for (const r of numericalReproductions) {
    assert.equal(r.source, `demos/${r.id}.m`);
    assert.ok(r.title && r.method && r.description);
    assert.ok(r.differences.length >= 3);
    assert.match(r.differences[0], /Independent TypeScript.*not execution/);
  }
  const power = numericalReproductions.find(r => r.id === 'powerCurvesDemo')!;
  assert.match(power.differences.join(' '), /approximate/);
  const group = numericalReproductions.find(r => r.id === 'groupLassoDemo')!;
  assert.match(group.differences.join(' '), /No block-L∞.*debiasing/);
});

for (const seed of [0, 1, 42, 987654321]) {
  test(`all thirteen numerical reproductions: finite shapes, mathematical checks, determinism, seed ${seed}`, () => {
    const started = performance.now();
    const results = numericalReproductions.map(r => {
      const start = performance.now(), result = r.run(seed);
      // Generous CI safety margin; the local measured whole suite is below one second.
      assert.ok(performance.now() - start < 2000, `${r.id}: bounded interactive workload exceeded 2s`);
      validateResult(r.id, result); return result;
    });
    const elapsed = performance.now() - started;
    for (let i = 0; i < numericalReproductions.length; i++) {
      assert.deepEqual(numericalReproductions[i].run(seed), results[i],
        `${numericalReproductions[i].id}: seeded output must be deterministic`);
    }
    assert.ok(elapsed < 5000, `complete suite exceeded a generous 5s CI ceiling (${elapsed}ms)`);
  });
}

test('seeded workloads actually change their observations rather than returning seed-independent canned plots', () => {
  for (const id of ['arsDemo', 'mcAccuracyDemo', 'mixGaussOverRelaxedEmDemo', 'minFunc_applications',
    'simulatedAnnealingDemo2d', 'miDemo', 'convMatMultDemo', 'groupLassoDemo']) {
    const r = numericalReproductions.find(r => r.id === id)!;
    assert.notDeepEqual(r.run(17).plots, r.run(18).plots, id);
  }
});

test('ARS independently matches exact Gaussian moments and a known Gaussian interval probability', () => {
  const fit = adaptiveRejection(x => -x * x, x => -2 * x, [-2, 0, 2], [-Infinity, Infinity], 6000, seededRandom(2026));
  // Density e^(-x²)/√π has variance 1/2, E[X^4]=3/4 and P(|X|≤1)=erf(1).
  near(mean(fit.samples), 0, .04);
  near(mean(fit.samples.map(x => x * x)), .5, .04);
  near(mean(fit.samples.map(x => x ** 4)), .75, .14);
  near(fit.samples.filter(x => Math.abs(x) <= 1).length / fit.samples.length, .8427007929497149, .025);
  assert.ok(fit.squeezed > 0);
  assert.ok(fit.evaluations < fit.proposals);
  assert.ok(fit.knots.length > 3 && fit.knots.length <= 96);
  assert.ok(fit.maxEnvelopeViolation < 1e-12);
  assert.ok(fit.samples.length / fit.proposals > .8);
});

test('ARS obeys half-line support and its analytic mean/second moment without clipped Gaussian draws', () => {
  const fit = adaptiveRejection(x => -x * x / 3, x => -2 * x / 3,
    [-4, -1, 0], [-Infinity, 0], 6000, seededRandom(73));
  assert.ok(fit.samples.every(x => x <= 0));
  near(mean(fit.samples), -Math.sqrt(3 / Math.PI), .05);
  near(mean(fit.samples.map(x => x * x)), 1.5, .14);
  assert.throws(() => adaptiveRejection(x => x * x, x => 2 * x,
    [-1, 1], [-Infinity, Infinity], 10, seededRandom(1)), /concave/);
  assert.throws(() => adaptiveRejection(x => -x * x, x => -2 * x,
    [1, 2], [-Infinity, Infinity], 10, seededRandom(1)), /integrable/);
});

test('extended Rosenbrock analytic gradient and Hessian match independent scalar finite differences', () => {
  const x = [-.8, .7, .1, -.4], { value, g, h } = rosenbrock(x), e = 1e-4;
  const scalar = (t: number[]) => sum(t.slice(0, -1).map((v, i) => 100 * (t[i + 1] - v * v) ** 2 + (1 - v) ** 2));
  near(value, scalar(x));
  for (let i = 0; i < x.length; i++) {
    const plus = [...x], minus = [...x]; plus[i] += e; minus[i] -= e;
    near(g[i], (scalar(plus) - scalar(minus)) / (2 * e), 5e-6);
    near(h[i][i], (scalar(plus) - 2 * scalar(x) + scalar(minus)) / e ** 2, 1e-4);
    for (let j = 0; j < i; j++) {
      const pp = [...x], pm = [...x], mp = [...x], mm = [...x];
      pp[i] += e; pp[j] += e; pm[i] += e; pm[j] -= e;
      mp[i] -= e; mp[j] += e; mm[i] -= e; mm[j] -= e;
      near(h[i][j], (scalar(pp) - scalar(pm) - scalar(mp) + scalar(mm)) / (4 * e * e), 1e-5);
      near(h[i][j], h[j][i]);
    }
  }
});

test('both real Rosenbrock optimizers recover the known minimum; high-dimensional Hessian has 3d−2 nonzeros', () => {
  for (const fit of [newtonMinimize(rosenbrock, [-1, 2]), bfgsRosenbrock([-1, 2])]) {
    near(fit.x[0], 1, 1e-6); near(fit.x[1], 1, 1e-6); near(fit.value, 0, 1e-12);
    assert.ok(fit.path.length > 5);
    fit.values.slice(1).forEach((v, i) => assert.ok(v <= fit.values[i] + 1e-10));
  }
  const atOne = rosenbrock(Array(12).fill(1));
  near(atOne.value, 0); near(norm(atOne.g), 0);
  assert.equal(atOne.h.flat().filter(x => x !== 0).length, 34);
  assert.deepEqual(rosenbrock([1, 1]).h, [[802, -400], [-400, 200]]);
});

test('disk-constrained optimum matches an independent one-dimensional boundary search, not clipped unconstrained optimization', () => {
  const fit = constrainedRosenbrock();
  const f = (theta: number) => (1 - Math.cos(theta)) ** 2 + 100 * (Math.sin(theta) - Math.cos(theta) ** 2) ** 2;
  // Golden-section oracle only sees the scalar boundary objective, no derivatives/barrier code.
  let lo = 0, hi = Math.PI / 2;
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 100; i++) {
    const a = hi - ratio * (hi - lo), b = lo + ratio * (hi - lo);
    if (f(a) < f(b)) hi = b; else lo = a;
  }
  const theta = (lo + hi) / 2;
  near(fit.x[0], Math.cos(theta), 2e-5);
  near(fit.x[1], Math.sin(theta), 2e-5);
  near(fit.value, f(theta), 1e-6);
  near(fit.value, .0456748087195, 1e-6);
  assert.ok(fit.path.every(p => dot(p, p) < 1));
  assert.ok(fit.stationarity < 1e-5 && fit.lambda > 0 && fit.slack > 0);
  // Radial clipping of (1,1) is feasible but demonstrably NOT the constrained solution.
  assert.ok(fit.value < rosenbrock([Math.SQRT1_2, Math.SQRT1_2]).value / 50);
});

test('KDE is an actual normalized Gaussian kernel sum with the stated Silverman bandwidth', () => {
  const x = range(2001).map(i => -10 + i / 100), data = [-1, 0, 1];
  const kde = kernelDensity(data, x), bandwidth = 1.06 * 3 ** (-.2);
  near(kde.bandwidth, bandwidth);
  const expectedAtZero = (2 * Math.exp(-.5 / bandwidth ** 2) + 1) / (3 * bandwidth * Math.sqrt(2 * Math.PI));
  near(kde.y[1000], expectedAtZero);
  near(integrate(x, kde.y), 1, 1e-10);
  kde.y.forEach((v, i) => near(v, kde.y[kde.y.length - 1 - i], 1e-14));
});

test('Monte Carlo plotted RMSE is quantitatively close to an independent σ/√N oracle', () => {
  const result = numericalReproductions.find(r => r.id === 'mcAccuracyDemo')!.run(24);
  const plot = result.plots.find(p => p.title.includes('100 independent trials'))!;
  const empirical = plot.traces[0], oracle = plot.traces[1];
  for (let i = 0; i < empirical.x.length; i++) {
    const expected = .25 / Math.sqrt(empirical.x[i] as number);
    near(oracle.y[i], expected);
    assert.ok(empirical.y[i] > .65 * expected && empirical.y[i] < 1.4 * expected);
  }
});

test('over-relaxation factor 1 exactly reproduces ordinary EM, not an invented reference curve', () => {
  const data = [-2, -1.8, -1.5, -.8, -.2, .5, .8, 1.2, 1.8, 2.2];
  const initial = { means: [-.5, .5], variances: [2, 2], weights: [.5, .5] };
  const em = gaussianEM(data, 2, 15, initial), or = overrelaxedEM(data, initial, 1, 15);
  em.history.forEach((row, i) => near(or.history[i], row.likelihood, 1e-11));
  em.means.forEach((mu, i) => near(or.means[i], mu, 1e-12));
  assert.equal(or.extrapolationsAccepted, 0);
  assert.equal(or.fallbacks, 0);
});

test('over-relaxed Gaussian EM equals the closed-form MLE for a single component and preserves normalization', () => {
  const data = [-3, -1, 0, 1, 3], fit = overrelaxedEM(data,
    { means: [4], variances: [10], weights: [1] }, 2, 10);
  near(fit.means[0], 0);
  near(fit.variances[0], 4);
  near(fit.weights[0], 1);
  near(fit.likelihood, data.length * (-.5 * Math.log(8 * Math.PI) - .5));
  fit.responsibilities.forEach(row => assert.deepEqual(row, [1]));
  fit.history.slice(1).forEach((v, i) => assert.ok(v >= fit.history[i] - 1e-12));
});

test('Huber IRLS recovers an exact line; symmetric contamination has the analytical clipped-score optimum', () => {
  const x = [-2, -1, 0, 1, 2].map(v => [1, v]), y = [-3, -1, 1, 3, 5];
  const exact = huberFit(x, y);
  near(exact.w[0], 1); near(exact.w[1], 2); near(exact.loss, 0);
  // Intercept-only observations: 0,0,0,100, δ=1 => 3w−1=0 => w=1/3.
  const contaminated = huberFit([[1], [1], [1], [1]], [0, 0, 0, 100], 1);
  near(contaminated.w[0], 1 / 3, 1e-9);
  near(contaminated.score[0], 0, 1e-10);
  contaminated.history.slice(1).forEach((v, i) => assert.ok(v <= contaminated.history[i] + 1e-10));
});

test('logistic Newton has the exact Bernoulli intercept MLE and does not penalize the intercept', () => {
  const design = Array.from({ length: 10 }, () => [1]), y = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0];
  for (const lambda of [0, 5]) {
    const fit = logisticFit(design, y, lambda);
    near(fit.x[0], Math.log(7 / 3), 1e-7);
    near(fit.value, -.7 * Math.log(.7) - .3 * Math.log(.3), 1e-12);
    assert.ok(norm(fit.g) < 1e-8);
  }
});

test('symmetric logistic slope MLE has a separate closed-form solution', () => {
  // P(y=1 | x=1)=3/4 and P(y=1 | x=−1)=1/4 => w0=0, w1=log(3).
  const design = [[1, -1], [1, -1], [1, -1], [1, -1], [1, 1], [1, 1], [1, 1], [1, 1]];
  const y = [0, 0, 0, 1, 1, 1, 1, 0], fit = logisticFit(design, y);
  near(fit.x[0], 0, 1e-8); near(fit.x[1], Math.log(3), 1e-7);
  const regularized = logisticFit(design, y, .2);
  near(regularized.x[0], 0, 1e-8);
  assert.ok(Math.abs(regularized.x[1]) < Math.abs(fit.x[1]));
});

test('natural Fisher equals the original Gaussian mean Jacobian Gram matrix', () => {
  const jacobian = [[3, 1 / 3], [1 / 3, 0]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++)
    near(naturalFisher[i][j], sum(jacobian.map(row => row[i] * row[j])));
  const fit = naturalGradientPaths(25), initialKL = .5 * ((3 - 1 / 3) ** 2 + (1 / 3) ** 2);
  fit.paths.natural.forEach((p, i) => {
    near(p[0], .8 ** i, 1e-12); near(p[1], -(.8 ** i), 1e-12);
    near(fit.losses.natural[i], initialKL * .64 ** i, 1e-12);
  });
  near(fit.paths.steepest[1][0], 1 - (9 + 1 / 9 - 1) / 45);
  near(fit.paths.steepest[1][1], -1 - (1 - 1 / 9) / 45);
});

test('Metropolis fixtures exercise uphill acceptance, rejection and unconditional downhill acceptance', () => {
  assert.equal(metropolisAccept(2, 1, .1), true); // e^−2 = 0.135335…
  assert.equal(metropolisAccept(2, 1, .2), false);
  assert.equal(metropolisAccept(2, .1, .01), false);
  assert.equal(metropolisAccept(-2, .001, .99999), true);
  assert.equal(metropolisAccept(0, 1, .5), true);
});

test('annealing objective is the original scaled peaks formula, independently evaluated and exhaustively bounded', () => {
  const scalar = (r: number, c: number) => {
    const x = c / 8 - 3, y = r / 8 - 3;
    const a = 3 * (1 - x) * (1 - x) / Math.exp(x * x + (y + 1) * (y + 1));
    const b = 10 * (x / 5 - x * x * x - y * y * y * y * y) / Math.exp(x * x + y * y);
    const cterm = 1 / (3 * Math.exp((x + 1) * (x + 1) + y * y));
    return (a - b - cterm) / 10;
  };
  let minimum = Infinity;
  for (let r = 0; r < 49; r++) for (let c = 0; c < 49; c++) {
    near(peaksEnergy(r, c), scalar(r, c), 1e-14); minimum = Math.min(minimum, scalar(r, c));
  }
  const fit = annealPeaks(10);
  assert.ok(fit.uphillAccepted > 0 && fit.rejected > 0);
  near(fit.temperatures.at(-1)!, .995 ** 1599);
  assert.ok(fit.bestEnergies.at(-1)! >= minimum - 1e-14);
  near(peaksEnergy(fit.best[0], fit.best[1]), fit.bestEnergies.at(-1)!);
  fit.path.forEach((p, i) => {
    assert.ok(p.every(v => Number.isInteger(v) && v >= 0 && v <= 48));
    near(fit.energies[i], scalar(p[0], p[1]), 1e-14);
    if (i > 0 && !fit.accepted[i - 1]) assert.deepEqual(p, fit.path[i - 1]);
  });
});

test('beta-binomial predictive enumeration matches exact uniform and Beta(2,3) fixtures', () => {
  for (const n of [1, 5, 25, 96]) betaBinomialMass(n, 1, 1).forEach(p => near(p, 1 / (n + 1), 1e-12));
  const pmf = betaBinomialMass(2, 2, 3);
  near(pmf[0], .4); near(pmf[1], .4); near(pmf[2], .2);
  const n = 15, a = 3, b = 7, mass = betaBinomialMass(n, a, b);
  near(sum(mass), 1, 1e-12);
  const expectedMean = n * a / (a + b);
  near(sum(mass.map((p, k) => k * p)), expectedMean);
  near(sum(mass.map((p, k) => (k - expectedMean) ** 2 * p)),
    n * a * b * (a + b + n) / ((a + b) ** 2 * (a + b + 1)), 1e-10);
});

test('grid HDIs independently match uniform, monotone and symmetric Beta analytical oracles', () => {
  near(betaGridHDI(1, 1).width, .95, 2 / 512);
  const left = betaGridHDI(1, 10), right = betaGridHDI(10, 1);
  near(left.lo, 0); near(right.hi, 1);
  near(left.hi, 1 - .05 ** .1, 2 / 512);
  near(right.lo, .05 ** .1, 2 / 512);
  near(left.width, right.width);
  // For symmetric Beta(2,2), the HDI is central, and F(x)=3x²−2x³.
  const symmetric = betaGridHDI(2, 2);
  near(symmetric.lo + symmetric.hi, 1, 2 / 512);
  const cdf = (x: number) => 3 * x * x - 2 * x ** 3;
  near(cdf(symmetric.hi) - cdf(symmetric.lo), .95, .004);
  assert.ok(symmetric.mass >= .95 - 1e-12);
  const fine = betaGridHDI(1, 10, 4096);
  assert.ok(Math.abs(fine.width - (1 - .05 ** .1)) < .0005);
});

test('Bayesian assurance plot is independently reconstructed from integer Beta-binomial weights and HDI event flags', () => {
  const result = numericalReproductions.find(r => r.id === 'powerCurvesDemo')!.run(99);
  const trace = result.plots[0].traces[1]; // mean 0.7, strength 10 => Beta(7,3)
  for (const i of [0, 8, 19]) {
    const n = trace.x[i] as number;
    // a,b integer => beta functions are factorial ratios; do not use logGamma/implementation PMF.
    const factorial = (k: number) => { let v = 1; for (let j = 2; j <= k; j++) v *= j; return v; };
    const beta = (a: number, b: number) => factorial(a - 1) * factorial(b - 1) / factorial(a + b - 1);
    const choose = (n: number, k: number) => factorial(n) / factorial(k) / factorial(n - k);
    let expected = 0;
    for (let k = 0; k <= n; k++) if (betaGridHDI(k + 1, n - k + 1).width <= .2)
      expected += choose(n, k) * beta(k + 7, n - k + 3) / beta(7, 3);
    near(trace.y[i], expected, 1e-11);
  }
});

test('mutual information fixtures: independence, identical bits, a binary symmetric channel, constants and relabeled categories', () => {
  near(discreteInformation([0, 0, 1, 1], [0, 1, 0, 1]).mi, 0);
  const identical = discreteInformation([0, 0, 1, 1], [0, 0, 1, 1]);
  near(identical.hx, Math.log(2)); near(identical.mi, Math.log(2));
  const x = [...Array(5).fill(0), ...Array(5).fill(1)], y = [1, 0, 0, 0, 0, 0, 1, 1, 1, 1];
  const binaryEntropy = -.2 * Math.log(.2) - .8 * Math.log(.8);
  near(discreteInformation(x, y).mi, Math.log(2) - binaryEntropy);
  near(discreteInformation(x.map(v => v ? 91 : -17), y.map(v => v ? 8 : 12)).mi, Math.log(2) - binaryEntropy);
  const constant = discreteInformation([3, 3, 3, 3], [0, 0, 1, 1]);
  near(constant.hx, 0); near(constant.mi, 0);
  const three = discreteInformation([1, 2, 3], [11, 12, 13]); near(three.mi, Math.log(3));
});

test('patch-matrix multiplication matches a hand-computed asymmetric-filter correlation, not convolution', () => {
  const image = [[1, 2, 3], [4, 5, 6], [7, 8, 9]], filter = [[1, 2], [3, 4]];
  const fit = crossCorrelationMatrices(image, filter);
  assert.deepEqual(fit.patches, [[1, 4, 2, 5], [4, 7, 5, 8], [2, 5, 3, 6], [5, 8, 6, 9]]);
  assert.deepEqual(fit.filterVector, [1, 3, 2, 4]);
  assert.deepEqual(fit.direct, [[37, 47], [67, 77]]);
  assert.deepEqual(fit.matrix, [[37, 47], [67, 77]]);
  const convolution = crossCorrelationMatrices(image, [[4, 3], [2, 1]]);
  assert.deepEqual(convolution.direct, [[23, 33], [53, 63]]);
  assert.notDeepEqual(fit.direct, convolution.direct);
});

test('column-major MATLAB reshape fixture and impulse filter test detect axis/order mistakes', () => {
  const image = range(4).map(r => range(5).map(c => 1 + r + 4 * c));
  const filter = [[0, 0, 0], [0, 1, 0], [0, 0, 0]], fit = crossCorrelationMatrices(image, filter);
  assert.deepEqual(fit.patches[0], [1, 2, 3, 5, 6, 7, 9, 10, 11]);
  assert.deepEqual(fit.direct, [[6, 10, 14], [7, 11, 15]]);
  assert.deepEqual(fit.direct, fit.matrix);
});

test('true group shrinkage has the analytical radial proximal solution and satisfies its vector KKT equation', () => {
  const actual = groupProx([3, 4, 0, 0, .1, -.1], 2, 2);
  near(actual[0], 1.8); near(actual[1], 2.4);
  assert.deepEqual(actual.slice(2), [0, 0, 0, -0]);
  near(groupProx([3, 4], 0, 2)[0], 3);
  assert.deepEqual(groupProx([3, 4], 5, 2), [0, 0]);
  const nonzero = actual.slice(0, 2);
  nonzero.forEach((v, i) => near(v - [3, 4][i] + 2 * v / norm(nonzero), 0));
  // Scalar soft threshold would be [1,2]; this explicitly detects an L1 substitute.
  assert.notDeepEqual(actual.slice(0, 2), [1, 2]);
});

test('proximal reconstruction exactly solves the identity-design group lasso and scalar lasso oracles', () => {
  const identity = range(4).map(i => range(4).map(j => i === j ? 1 : 0));
  const y = [3, 4, .1, -.1], group = sparseReconstruct(identity, y, 2, 2), scalar = sparseReconstruct(identity, y, 2, 1);
  group.w.forEach((v, i) => near(v, [1.8, 2.4, 0, 0][i]));
  scalar.w.forEach((v, i) => near(v, [1, 2, 0, 0][i]));
  near(group.proximalResidual, 0); near(scalar.proximalResidual, 0);
  const expected = .5 * (1.2 ** 2 + 1.6 ** 2 + .1 ** 2 + .1 ** 2) + 2 * 3;
  near(group.history.at(-1)!, expected);
  assert.ok(group.history.at(-1)! < group.history[0]);
});
