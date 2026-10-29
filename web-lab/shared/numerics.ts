/** Independent, double-precision educational implementations; not PMTK outputs. */
export type Matrix = number[][];
export function sum(x: number[]) { return x.reduce((a, b) => a + b, 0); }
export function logSumExp(x: number[]): number {
  const m = Math.max(...x);
  if (m === -Infinity) return m;
  return m + Math.log(sum(x.map(v => Math.exp(v - m))));
}
function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new RangeError(message);
}
function finite(x: number) { return Number.isFinite(x); }
export function seededRandom(seed = 42): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function normal(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, rng()))) * Math.cos(2 * Math.PI * rng());
}
export function logGamma(z: number): number {
  const p = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = .9999999999998099;
  p.forEach((v, i) => { x += v / (z + i + 1); });
  const t = z + p.length - .5;
  return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
}
export function betaDensity(x: number, a: number, b: number) {
  check([x, a, b].every(finite) && a > 0 && b > 0 && x >= 0 && x <= 1, 'Invalid Beta density parameters');
  if (x === 0) return a < 1 ? Infinity : a === 1 ? b : 0;
  if (x === 1) return b < 1 ? Infinity : b === 1 ? a : 0;
  const logB = logGamma(a) + logGamma(b) - logGamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - logB);
}
export function betaBernoulli(a = 2, b = 2, heads = 7, tails = 3) {
  check(a > 0 && b > 0 && [a, b].every(finite), 'Positive finite prior required');
  check([heads, tails].every(v => Number.isInteger(v) && v >= 0 && v <= 10000), 'Invalid counts');
  const alpha = a + heads, beta = b + tails;
  const logB = (u: number, v: number) => logGamma(u) + logGamma(v) - logGamma(u + v);
  const x = Array.from({ length: 401 }, (_, i) => (i + .5) / 401);
  return {
    alpha, beta, mean: alpha / (alpha + beta),
    variance: alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1)),
    predictive: alpha / (alpha + beta),
    // Evidence for an ordered toss sequence, without a binomial coefficient.
    logEvidence: logB(alpha, beta) - logB(a, b),
    x, prior: x.map(t => betaDensity(t, a, b)), posterior: x.map(t => betaDensity(t, alpha, beta)),
  };
}

/** QR least squares. Ridge adds sqrt(lambda) rows, never penalizing intercept column 0. */
export function linearFit(design: Matrix, y: number[], lambda = 0) {
  check(design.length === y.length && y.length > 0 && lambda >= 0 && finite(lambda), 'Invalid regression input');
  const p = design[0].length;
  check(p > 0 && design.every(row => row.length === p && row.every(finite)) && y.every(finite), 'Invalid design');
  const a = design.map(row => [...row]), target = [...y];
  if (lambda > 0) for (let j = 1; j < p; j++) {
    a.push(Array.from({ length: p }, (_, k) => k === j ? Math.sqrt(lambda) : 0));
    target.push(0);
  }
  const q: Matrix = [], r = Array.from({ length: p }, () => Array(p).fill(0) as number[]);
  for (let j = 0; j < p; j++) {
    const v = a.map(row => row[j]);
    // Two passes of modified Gram-Schmidt reduce loss of orthogonality.
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
      const projection = sum(v.map((x, i) => x * q[k][i]));
      r[k][j] += projection;
      v.forEach((_, i) => { v[i] -= projection * q[k][i]; });
    }
    r[j][j] = Math.sqrt(sum(v.map(x => x * x)));
    check(r[j][j] > 1e-12, 'Rank-deficient design: add ridge or reduce degree');
    q.push(v.map(x => x / r[j][j]));
  }
  const coefficients = q.map(col => sum(col.map((x, i) => x * target[i])));
  for (let j = p - 1; j >= 0; j--) {
    for (let k = j + 1; k < p; k++) coefficients[j] -= r[j][k] * coefficients[k];
    coefficients[j] /= r[j][j];
  }
  const fitted = design.map(row => sum(row.map((v, i) => v * coefficients[i])));
  const sse = sum(y.map((v, i) => (v - fitted[i]) ** 2));
  return { coefficients, fitted, sse, rmse: Math.sqrt(sse / y.length),
    objective: sse + lambda * sum(coefficients.slice(1).map(v => v * v)) };
}
export function regressionDemo(seed = 42, noise = .35, degree = 3, lambda = .1, n = 40) {
  const rng = seededRandom(seed);
  const x = Array.from({ length: n }, () => 2 * rng() - 1).sort((a, b) => a - b);
  const truth = (v: number) => .6 + .9 * v - .5 * v ** 2 + .75 * v ** 3;
  const y = x.map(v => truth(v) + noise * normal(rng));
  const row = (v: number) => Array.from({ length: degree + 1 }, (_, j) => v ** j);
  const fit = linearFit(x.map(row), y, lambda);
  const grid = Array.from({ length: 151 }, (_, i) => -1 + i / 75);
  return { ...fit, x, y, grid, truth: grid.map(truth),
    prediction: grid.map(v => sum(row(v).map((c, i) => c * fit.coefficients[i]))) };
}

export function symmetricEigen2(a: number, b: number, d: number) {
  check([a, b, d].every(finite), 'Nonfinite covariance');
  const radius = Math.hypot((a - d) / 2, b), center = (a + d) / 2;
  const theta = .5 * Math.atan2(2 * b, a - d);
  const c = Math.cos(theta), s = Math.sin(theta);
  return { values: [center + radius, center - radius], vectors: [[c, s], [-s, c]] };
}
export type CovarianceConvention = 'population' | 'sample';
export function pca2(points: Matrix, covarianceConvention: CovarianceConvention = 'population') {
  check(points.length >= 2 && points.every(row => row.length === 2 && row.every(finite)), 'Need 2D observations');
  check(covarianceConvention === 'population' || covarianceConvention === 'sample', 'Unknown PCA covariance convention');
  const mean = [0, 1].map(j => sum(points.map(p => p[j])) / points.length);
  const centered = points.map(p => p.map((v, j) => v - mean[j]));
  // pcaPmtk uses cov(X,1) and S^2/N. Sample covariance is an explicit opt-in.
  const covarianceDivisor = covarianceConvention === 'population' ? points.length : points.length - 1;
  const cov = (j: number, k: number) => sum(centered.map(p => p[j] * p[k])) / covarianceDivisor;
  const covariance = [[cov(0, 0), cov(0, 1)], [cov(0, 1), cov(1, 1)]];
  const eig = symmetricEigen2(covariance[0][0], covariance[0][1], covariance[1][1]);
  const scores = centered.map(p => eig.vectors.map(v => p[0] * v[0] + p[1] * v[1]));
  return { mean, covariance, covarianceConvention, covarianceDivisor, eigenvalues: eig.values, eigenvectors: eig.vectors, scores,
    explained: sum(eig.values) > 0 ? eig.values[0] / sum(eig.values) : 0,
    reconstructed: scores.map(s => mean.map((v, j) => v + s[0] * eig.vectors[0][j])) };
}
export function pcaDemo(seed = 42, angle = 35, spread = .45, n = 140, covarianceConvention: CovarianceConvention = 'population') {
  const rng = seededRandom(seed), theta = angle * Math.PI / 180;
  const points = Array.from({ length: n }, () => {
    const u = 1.7 * normal(rng), v = spread * normal(rng);
    return [u * Math.cos(theta) - v * Math.sin(theta), u * Math.sin(theta) + v * Math.cos(theta)];
  });
  return { points, ...pca2(points, covarianceConvention) };
}

const logNormal = (x: number, mu: number, variance: number) =>
  -.5 * (Math.log(2 * Math.PI * variance) + (x - mu) ** 2 / variance);
export interface GaussianInitial { means: number[]; variances: number[]; weights: number[] }
export function gaussianEM(data: number[], components = 2, iterations = 35, initial?: GaussianInitial, convergenceTolerance?: number) {
  check(data.length >= components && data.every(finite), 'Not enough finite observations');
  check(Number.isInteger(components) && components >= 1 && components <= 8, 'Invalid component count');
  check(Number.isInteger(iterations) && iterations >= 0 && iterations <= 200, 'Invalid iteration count');
  check(convergenceTolerance === undefined || finite(convergenceTolerance) && convergenceTolerance > 0, 'Invalid convergence tolerance');
  const sorted = [...data].sort((a, b) => a - b), n = data.length;
  const avg = sum(data) / n, variance = Math.max(1e-6, sum(data.map(x => (x - avg) ** 2)) / n);
  if (initial) {
    check([initial.means, initial.variances, initial.weights].every(row => row.length === components && row.every(finite)) &&
      initial.variances.every(v => v >= 1e-6) && initial.weights.every(v => v > 0) &&
      Math.abs(sum(initial.weights) - 1) < 1e-9, 'Invalid initial Gaussian mixture');
  }
  let means = initial ? [...initial.means] : Array.from({ length: components }, (_, k) => sorted[Math.floor((k + .5) * n / components)]);
  let variances = initial ? [...initial.variances] : means.map(() => variance);
  let weights = initial ? [...initial.weights] : means.map(() => 1 / components);
  const expectation = () => {
    let likelihood = 0;
    const responsibilities = data.map(x => {
      const row = means.map((mu, k) => Math.log(weights[k]) + logNormal(x, mu, variances[k]));
      const z = logSumExp(row);
      likelihood += z;
      return row.map(v => Math.exp(v - z));
    });
    return { likelihood, responsibilities };
  };
  let e = expectation();
  let converged = false;
  const history = [{ iteration: 0, likelihood: e.likelihood, means: [...means],
    variances: [...variances], weights: [...weights] }];
  for (let step = 1; step <= iterations; step++) {
    const counts = means.map((_, k) => sum(e.responsibilities.map(row => row[k])));
    // Empty components retain their parameters and receive tiny positive mass.
    means = means.map((old, k) => counts[k] > 1e-12
      ? sum(data.map((x, i) => x * e.responsibilities[i][k])) / counts[k] : old);
    variances = variances.map((old, k) => counts[k] > 1e-12
      ? Math.max(1e-6, sum(data.map((x, i) => (x - means[k]) ** 2 * e.responsibilities[i][k])) / counts[k]) : old);
    weights = counts.map(c => Math.max(1e-12, c / n));
    const z = sum(weights);
    weights = weights.map(w => w / z);
    e = expectation();
    history.push({ iteration: step, likelihood: e.likelihood, means: [...means],
      variances: [...variances], weights: [...weights] });
    if (convergenceTolerance !== undefined) {
      const previous = history[step - 1].likelihood;
      const average = (Math.abs(e.likelihood) + Math.abs(previous) + Number.EPSILON) / 2;
      if (Math.abs(e.likelihood - previous) / average < convergenceTolerance) {
        converged = true;
        break;
      }
    }
  }
  return { means, variances, weights, ...e, history, converged, iterationsUsed: history.length - 1 };
}
export function emDemo(seed = 42, separation = 3, iterations = 35) {
  const rng = seededRandom(seed);
  const data = Array.from({ length: 220 }, () => {
    const component = rng() < .4 ? 0 : 1;
    return (component === 0 ? -separation / 2 : separation / 2) + normal(rng) * (component === 0 ? .65 : .9);
  });
  const fit = gaussianEM(data, 2, iterations);
  const x = Array.from({ length: 200 }, (_, i) => -6 + 12 * i / 199);
  const curves = fit.means.map((mu, k) => x.map(v => fit.weights[k] * Math.exp(logNormal(v, mu, fit.variances[k]))));
  return { data, x, curves, density: x.map((_, i) => sum(curves.map(c => c[i]))), ...fit };
}

function distribution(row: number[]) {
  check(row.length > 0 && row.every(v => finite(v) && v >= 0) && Math.abs(sum(row) - 1) < 1e-9,
    'Probability rows must sum to one');
}
export function hmmForwardBackward(initial: number[], transition: Matrix, emission: Matrix, observations: number[]) {
  const k = initial.length, t = observations.length;
  distribution(initial);
  check(k > 0 && transition.length === k && emission.length === k && t > 0, 'Invalid HMM shape');
  transition.forEach(row => { check(row.length === k, 'Invalid transition width'); distribution(row); });
  const symbols = emission[0].length;
  emission.forEach(row => { check(row.length === symbols, 'Invalid emission width'); distribution(row); });
  check(observations.every(v => Number.isInteger(v) && v >= 0 && v < symbols), 'Invalid observation symbol');
  const lt = transition.map(row => row.map(Math.log)), le = emission.map(row => row.map(Math.log));
  const alpha: Matrix = [initial.map((p, s) => Math.log(p) + le[s][observations[0]])];
  for (let i = 1; i < t; i++) alpha.push(initial.map((_, s) =>
    le[s][observations[i]] + logSumExp(alpha[i - 1].map((v, r) => v + lt[r][s]))));
  const logLikelihood = logSumExp(alpha[t - 1]);
  check(finite(logLikelihood), 'Sequence has zero probability under this model');
  const beta = Array.from({ length: t }, () => initial.map(() => 0));
  for (let i = t - 2; i >= 0; i--) for (let s = 0; s < k; s++) {
    beta[i][s] = logSumExp(initial.map((_, r) => lt[s][r] + le[r][observations[i + 1]] + beta[i + 1][r]));
  }
  const marginals = alpha.map((row, i) => {
    const logs = row.map((v, s) => v + beta[i][s]), z = logSumExp(logs);
    return logs.map(v => Math.exp(v - z));
  });
  const expectedTransitions = Array.from({ length: k }, () => initial.map(() => 0));
  for (let i = 0; i < t - 1; i++) {
    const logs = initial.flatMap((_, s) => initial.map((_, r) =>
      alpha[i][s] + lt[s][r] + le[r][observations[i + 1]] + beta[i + 1][r]));
    const z = logSumExp(logs);
    for (let s = 0; s < k; s++) for (let r = 0; r < k; r++) expectedTransitions[s][r] += Math.exp(logs[s * k + r] - z);
  }
  // Separate max-product dynamic program: not the smoothed marginal argmax.
  const delta = [alpha[0].slice()], back = [initial.map(() => 0)];
  for (let i = 1; i < t; i++) {
    const pointers: number[] = [];
    delta.push(initial.map((_, s) => {
      const options = delta[i - 1].map((v, r) => v + lt[r][s]);
      const best = Math.max(...options);
      pointers.push(options.indexOf(best));
      return best + le[s][observations[i]];
    }));
    back.push(pointers);
  }
  const viterbi = Array(t).fill(0) as number[];
  viterbi[t - 1] = delta[t - 1].indexOf(Math.max(...delta[t - 1]));
  for (let i = t - 2; i >= 0; i--) viterbi[i] = back[i + 1][viterbi[i + 1]];
  return { logLikelihood, marginals, expectedTransitions, viterbi, alpha, beta };
}
export function hmmDemo(stay = .85, accuracy = .8, sequence = '0010111001') {
  check(sequence.length >= 1 && sequence.length <= 200 && /^[01]+$/.test(sequence), 'Use 1–200 binary observations');
  const initial = [.5, .5], transition = [[stay, 1 - stay], [1 - stay, stay]];
  const emission = [[accuracy, 1 - accuracy], [1 - accuracy, accuracy]];
  const observations = [...sequence].map(Number);
  return { initial, transition, emission, observations, ...hmmForwardBackward(initial, transition, emission, observations) };
}

export type Evidence = Partial<Record<'cloudy' | 'sprinkler' | 'rain' | 'wet', boolean>>;
export function sprinkler(evidence: Evidence = { wet: true }, cloudPrior = .5, leak = 0) {
  check([cloudPrior, leak].every(v => finite(v) && v >= 0 && v <= 1), 'Invalid network probabilities');
  const states: { cloudy: boolean; sprinkler: boolean; rain: boolean; wet: boolean; probability: number }[] = [];
  for (const cloudy of [false, true]) for (const s of [false, true]) for (const rain of [false, true]) for (const wet of [false, true]) {
    const pc = cloudy ? cloudPrior : 1 - cloudPrior;
    const ps = cloudy ? .1 : .5, pr = cloudy ? .8 : .2;
    const pw = s && rain ? .99 : s || rain ? .9 : leak;
    states.push({ cloudy, sprinkler: s, rain, wet,
      probability: pc * (s ? ps : 1 - ps) * (rain ? pr : 1 - pr) * (wet ? pw : 1 - pw) });
  }
  const keys = ['cloudy', 'sprinkler', 'rain', 'wet'] as const;
  const compatible = states.filter(s => keys.every(key => evidence[key] === undefined || evidence[key] === s[key]));
  const evidenceProbability = sum(compatible.map(s => s.probability));
  check(evidenceProbability > 0, 'Evidence has zero probability');
  const posterior = Object.fromEntries(keys.map(key =>
    [key, sum(compatible.filter(s => s[key]).map(s => s.probability)) / evidenceProbability])) as Record<typeof keys[number], number>;
  const prior = Object.fromEntries(keys.map(key =>
    [key, sum(states.filter(s => s[key]).map(s => s.probability))])) as Record<typeof keys[number], number>;
  return { evidence, evidenceProbability, posterior, prior, states };
}

export const adapterIds = ['beta', 'regression', 'pca', 'em', 'hmm', 'sprinkler'] as const;
export type AdapterId = typeof adapterIds[number];
export function numericalFixtures() {
  return {
    seed: 42, implementation: 'independent TypeScript reproduction; IEEE-754 double',
    beta: betaBernoulli(),
    regression: regressionDemo(),
    pca: pcaDemo(),
    em: emDemo(),
    hmm: hmmDemo(),
    sprinkler: sprinkler(),
  };
}
/** Fixed supplied inputs; independently computed TS outputs, not original-engine data. */
export function parityFixtures() {
  const prior = [.5, .5], observations = [1, 0, 1, 1, 0, 1], heads = sum(observations);
  const beta = betaBernoulli(prior[0], prior[1], heads, observations.length - heads), betaX = [.2, .5, .8];
  const x = [-2, -1, 0, 1, 2], y = [-2.9, -1.1, 1, 3.1, 4.9], design = x.map(v => [1, v]);
  const points = [[-2, -1], [-1, -.5], [0, 0], [1, .5], [2, 1]], pca = pca2(points);
  const initial = [.6, .4], transition = [[.7, .3], [.4, .6]], emission = [[.5, .5], [.1, .9]], observed = [0, 1, 0];
  const hmm = hmmForwardBackward(initial, transition, emission, observed);
  const network = sprinkler({ wet: true });
  const data = [-3, -2.5, -2, -1.5, 1.5, 2, 2.5, 3], start = { means: [-2, 2], variances: [1, 1], weights: [.5, .5] };
  const mixture = gaussianEM(data, 2, 25, start, 1e-10);
  const basis = pca.eigenvectors[0];
  return {
    implementation: 'independent TypeScript reproduction; IEEE-754 double',
    scope: 'Fixed inputs for cross-engine comparison; not proof of correctness for all original demos',
    beta: { prior, observations, posterior: [beta.alpha, beta.beta], mean: beta.mean,
      x: betaX, density: betaX.map(v => betaDensity(v, beta.alpha, beta.beta)) },
    regression: { x, y, ols: linearFit(design, y).coefficients, ridgeLambda: 2, ridge: linearFit(design, y, 2).coefficients },
    pca: { points, covarianceConvention: 'population, divide by N', covariance: pca.covariance,
      basis, eigenvalues: pca.eigenvalues, reconstruction: pca.reconstructed,
      projector: basis.map(v => basis.map(w => v * w)) },
    hmm: { initial, transition, emission, observationsZeroBased: observed, gammaOrientation: 'state × time',
      gamma: initial.map((_, state) => hmm.marginals.map(row => row[state])),
      marginalOrientation: 'time × state', marginals: hmm.marginals,
      logLikelihood: hmm.logLikelihood, viterbi: hmm.viterbi },
    sprinkler: { wet: network.evidenceProbability, rainGivenWet: network.posterior.rain },
    mixture: { data, initial: { mu: start.means, Sigma: start.variances, mixWeight: start.weights },
      means: mixture.means, variances: mixture.variances, weights: mixture.weights,
      training: { objective: 'MLE', prior: 'none', mixPrior: 'none', maxIter: 25, convTol: 1e-10,
        converged: mixture.converged, iterationsUsed: mixture.iterationsUsed,
        historyConvention: 'Initial likelihood, then likelihood after each completed update' },
      logLikelihoodHistory: mixture.history.map(row => row.likelihood) },
  };
}
