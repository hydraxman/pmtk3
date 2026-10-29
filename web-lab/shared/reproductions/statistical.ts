/**
 * Independent bounded educational experiments, not saved PMTK/MATLAB results.
 * Grounding: demos/<id>.m, binaryFAfit/varInferLogisticGauss,
 * linregFitSparseEm, and linregSparseScadFitLLA. Formula references:
 * FA: E[z|x]=B x, E[zz']=I-BL+B S B'; Rubin & Thayer (1982).
 * SCAD: Fan & Li (2001), derivative and local linear approximation.
 * GP: Newton mode and inverse negative Hessian of a Poisson log-GP posterior.
 * All benchmark substitutions and omissions are declared on each definition.
 */
import type { Reproduction, ExperimentResult, VisualPlot, VisualTrace } from './types.js';
import {
  seededRandom, normal, range, zeros, sum, mean, dot, transpose, norm, sigmoid,
  softThreshold, solve, cholesky, symmetricEigen, matrixPlot, scatter, line,
} from './math.js';
import { logSumExp } from '../numerics.js';

type Matrix = number[][];
const identity = (n: number) => range(n).map(i => range(n).map(j => +(i === j)));
const multiply = (a: Matrix, b: Matrix) => {
  const bt = transpose(b);
  return a.map(row => bt.map(col => dot(row, col)));
};
const mv = (a: Matrix, v: number[]) => a.map(row => dot(row, v));
const squaredError = (a: number[], b: number[]) => mean(a.map((v, i) => (v - b[i]) ** 2));
const monotone = (a: number[], increasing = true, tol = 1e-7) =>
  a.slice(1).every((v, i) => increasing ? v >= a[i] - tol : v <= a[i] + tol);
const bars = (name: string, x: string[], y: number[]): VisualTrace => ({ name, type: 'bar', x, y });
const curve = (title: string, traces: VisualTrace[], xLabel?: string, yLabel?: string): VisualPlot =>
  ({ title, traces, xLabel, yLabel });
const check = (name: string, passed: boolean, detail?: string) => ({ name, passed, detail });
const covariance = (x: Matrix) => multiply(transpose(x), x).map(row => row.map(v => v / x.length));
function center(x: Matrix) {
  const mu = transpose(x).map(mean);
  return { mu, data: x.map(row => row.map((v, j) => v - mu[j])) };
}
function inverseSPD(a: Matrix) {
  const l = cholesky(a), n = a.length;
  const columns = range(n).map(k => {
    const y = Array<number>(n).fill(0), x = [...y];
    for (let i = 0; i < n; i++) {
      y[i] = ((i === k ? 1 : 0) - sum(range(i).map(j => l[i][j] * y[j]))) / l[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      x[i] = (y[i] - sum(range(n - i - 1).map(j => l[i + j + 1][i] * x[i + j + 1]))) / l[i][i];
    }
    return x;
  });
  return transpose(columns);
}
const logDetSPD = (a: Matrix) => 2 * sum(cholesky(a).map((row, i) => Math.log(row[i])));

/** Population-covariance PCA, with components as rows (not a factor-analysis fit). */
export function statisticalPca(x: Matrix, rank = 2) {
  const { mu, data } = center(x), s = covariance(data), eig = symmetricEigen(s);
  const scores = data.map(row => eig.vectors.map(v => dot(row, v)));
  const reconstruction = (k: number) => scores.map(row => mu.map((v, j) =>
    v + sum(range(k).map(q => row[q] * eig.vectors[q][j]))));
  return { mu, covariance: s, ...eig, scores, reconstructed: reconstruction(rank), reconstruction };
}

/** Actual maximum-likelihood Gaussian FA EM; diagonal, non-isotropic uniquenesses. */
export function maximumLikelihoodFA(x: Matrix, q = 2, iterations = 100) {
  const { mu, data } = center(x), s = covariance(data), d = s.length, n = x.length;
  const eig = symmetricEigen(s);
  const initialNoise = Math.max(1e-4, mean(eig.values.slice(q)));
  let loadings = range(d).map(j => range(q).map(k =>
    eig.vectors[k][j] * Math.sqrt(Math.max(1e-4, eig.values[k] - initialNoise))));
  let uniqueness = range(d).map(j => Math.max(1e-4, s[j][j] - dot(loadings[j], loadings[j])));
  const modelCov = () => multiply(loadings, transpose(loadings)).map((row, i) =>
    row.map((v, j) => v + (i === j ? uniqueness[i] : 0)));
  const logLikelihood = () => {
    const c = modelCov(), ci = inverseSPD(c);
    return -.5 * n * (d * Math.log(2 * Math.PI) + logDetSPD(c) +
      sum(range(d).map(i => dot(ci[i], s[i]))));
  };
  const posteriorMap = () => {
    const scaled = transpose(loadings).map(row => row.map((v, j) => v / uniqueness[j]));
    const a = multiply(scaled, loadings).map((row, i) => row.map((v, j) => v + +(i === j)));
    return multiply(inverseSPD(a), scaled);
  };
  const history = [logLikelihood()];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const b = posteriorMap(), sxz = multiply(s, transpose(b)), bl = multiply(b, loadings);
    const bsbt = multiply(b, sxz);
    const ezz = range(q).map(i => range(q).map(j => +(i === j) - bl[i][j] + bsbt[i][j]));
    const next = multiply(sxz, inverseSPD(ezz));
    uniqueness = range(d).map(j => Math.max(1e-5, s[j][j] - dot(next[j], sxz[j])));
    loadings = next;
    history.push(logLikelihood());
  }
  const b = posteriorMap();
  return { mu, loadings, uniqueness, covariance: modelCov(), scores: multiply(data, transpose(b)), history };
}

/** 1/(2n)||y-Xw||² + sum_j lambda_j |w_j|, by residual coordinate descent. */
export function statisticalLasso(x: Matrix, y: number[], penalties: number[], initial?: number[]) {
  const n = x.length, p = x[0].length, w = initial ? [...initial] : Array<number>(p).fill(0);
  const residual = y.map((v, i) => v - dot(x[i], w));
  const scale = range(p).map(j => sum(x.map(row => row[j] ** 2)) / n);
  for (let iteration = 0; iteration < 400; iteration++) {
    let change = 0;
    for (let j = 0; j < p; j++) {
      const rho = sum(x.map((row, i) => row[j] * residual[i])) / n + scale[j] * w[j];
      const next = scale[j] > 1e-12 ? softThreshold(rho, penalties[j]) / scale[j] : 0;
      const delta = next - w[j];
      change = Math.max(change, Math.abs(delta));
      for (let i = 0; i < n; i++) residual[i] -= x[i][j] * delta;
      w[j] = next;
    }
    if (change < 1e-9) break;
  }
  return w;
}
export function scadPenalty(value: number, lambda: number, a = 3.7) {
  const v = Math.abs(value);
  return v <= lambda ? lambda * v : v <= a * lambda
    ? (-v * v + 2 * a * lambda * v - lambda ** 2) / (2 * (a - 1))
    : (a + 1) * lambda ** 2 / 2;
}
export function scadDerivative(value: number, lambda: number, a = 3.7) {
  const v = Math.abs(value);
  return v <= lambda ? lambda : Math.max(0, a * lambda - v) / (a - 1);
}
export function statisticalScad(x: Matrix, y: number[], lambda: number) {
  let weights = statisticalLasso(x, y, x[0].map(() => lambda));
  const objective = () => .5 * squaredError(y, mv(x, weights)) +
    sum(weights.map(v => scadPenalty(v, lambda)));
  const history = [objective()];
  for (let iteration = 0; iteration < 25; iteration++) {
    weights = statisticalLasso(x, y, weights.map(v => scadDerivative(v, lambda)), weights);
    history.push(objective());
  }
  return { weights, history };
}

/** Gaussian-Gamma precision mixture: E[alpha_j|w_j]=(nu+1)/(nu*s²+w_j²). */
export function studentTRegressionEM(x: Matrix, y: number[], sigma = .45, nu = .2, scale = .04) {
  const xt = transpose(x), xtx = multiply(xt, x), xty = mv(xt, y);
  let weights = solve(xtx.map((row, i) => row.map((v, j) => v + (i === j ? 1 : 0))), xty);
  const objective = () => sum(y.map((v, i) => (v - dot(x[i], weights)) ** 2)) / (2 * sigma ** 2) +
    .5 * (nu + 1) * sum(weights.map(v => Math.log(nu * scale ** 2 + v * v)));
  const history = [objective()];
  for (let step = 0; step < 65; step++) {
    const precision = weights.map(v => (nu + 1) / (nu * scale ** 2 + v * v));
    weights = solve(xtx.map((row, i) => row.map((v, j) => v + (i === j ? sigma ** 2 * precision[i] : 0))), xty);
    history.push(objective());
  }
  return { weights, history };
}

export interface CategoricalMixture {
  weights: number[];
  probabilities: number[][][]; // component, variable, zero-based category
}
export function categoricalPosterior(model: CategoricalMixture, row: number[]) {
  const logs = model.weights.map((weight, k) => Math.log(weight) +
    sum(row.map((v, j) => Number.isNaN(v) ? 0 : Math.log(model.probabilities[k][j][v]))));
  const logProbability = logSumExp(logs);
  return { logProbability, responsibilities: logs.map(v => Math.exp(v - logProbability)) };
}
export function categoricalPredict(model: CategoricalMixture, row: number[]) {
  const { responsibilities } = categoricalPosterior(model, row);
  return model.probabilities[0].map((categories, j) => categories.map((_, c) =>
    sum(model.weights.map((_, k) => responsibilities[k] * model.probabilities[k][j][c]))));
}
/** Exact EM for a mixture of product-categorical distributions, no latent FA surrogate. */
export function fitCategoricalMixture(x: Matrix, components: number, states: number, seed: number, iterations = 45) {
  const rng = seededRandom(seed), d = x[0].length;
  const prototypes = [x[Math.floor(rng() * x.length)]];
  while (prototypes.length < components) {
    const distances = x.map(row => Math.min(...prototypes.map(p => sum(row.map((v, j) => +(v !== p[j]))))));
    prototypes.push(x[distances.indexOf(Math.max(...distances))]);
  }
  const model: CategoricalMixture = {
    weights: Array<number>(components).fill(1 / components),
    probabilities: prototypes.map(row => row.map(v => range(states).map(c => c === v ? .8 : .2 / (states - 1)))),
  };
  const likelihood = () => sum(x.map(row => categoricalPosterior(model, row).logProbability));
  const history = [likelihood()];
  for (let step = 0; step < iterations; step++) {
    const r = x.map(row => categoricalPosterior(model, row).responsibilities);
    const counts = range(components).map(k => sum(r.map(row => row[k])));
    // Tiny probability floor prevents log(0); at most 1e-8 perturbations.
    model.weights = counts.map(c => Math.max(1e-12, c / x.length));
    const total = sum(model.weights);
    model.weights = model.weights.map(v => v / total);
    model.probabilities = range(components).map(k => range(d).map(j => {
      const mass = range(states).map(c => Math.max(1e-10,
        sum(x.map((row, i) => row[j] === c ? r[i][k] : 0)) / Math.max(1e-12, counts[k])));
      return mass.map(v => v / sum(mass));
    }));
    history.push(likelihood());
  }
  return { ...model, history };
}

/** Alternating block Newton MAP logistic factorization; NOT marginal-ML binary FA. */
export function logisticMatrixFactorization(x: Matrix, seed: number, rank = 2, iterations = 28) {
  const rng = seededRandom(seed), n = x.length, d = x[0].length;
  const z = range(n).map(() => range(rank).map(() => .3 * normal(rng)));
  const w = range(d).map(() => range(rank).map(() => .3 * normal(rng)));
  const bias = transpose(x).map(col => {
    const p = (sum(col) + .5) / (n + 1);
    return Math.log(p / (1 - p));
  });
  const softplus = (v: number) => Math.max(0, v) + Math.log1p(Math.exp(-Math.abs(v)));
  const block = (design: Matrix, labels: number[], coefficients: number[], offset: number[], precision: number[]) => {
    const value = (b: number[]) => sum(design.map((row, i) => {
      const eta = offset[i] + dot(row, b);
      return softplus(eta) - labels[i] * eta;
    })) + .5 * sum(b.map((v, j) => precision[j] * v * v));
    const p = design.map((row, i) => sigmoid(offset[i] + dot(row, coefficients)));
    const gradient = coefficients.map((v, j) => precision[j] * v +
      sum(design.map((row, i) => row[j] * (p[i] - labels[i]))));
    const hessian = coefficients.map((_, j) => coefficients.map((__, k) =>
      (j === k ? precision[j] : 0) + sum(design.map((row, i) => row[j] * row[k] * p[i] * (1 - p[i])))));
    const direction = solve(hessian, gradient), before = value(coefficients);
    for (let rate = 1; rate > 1e-7; rate *= .5) {
      const candidate = coefficients.map((v, j) => v - rate * direction[j]);
      if (value(candidate) <= before + 1e-12) return candidate;
    }
    return coefficients;
  };
  const objective = () => sum(x.map((row, i) => sum(row.map((v, j) => {
    const eta = bias[j] + dot(z[i], w[j]);
    return softplus(eta) - v * eta;
  })))) + .5 * sum(z.flat().map(v => v * v)) + .1 * sum(w.flat().map(v => v * v)) +
    .0005 * sum(bias.map(v => v * v));
  const history = [objective()];
  for (let step = 0; step < iterations; step++) {
    for (let i = 0; i < n; i++) z[i] = block(w, x[i], z[i], bias, Array<number>(rank).fill(1));
    const design = z.map(row => [...row, 1]);
    for (let j = 0; j < d; j++) {
      const beta = block(design, x.map(row => row[j]), [...w[j], bias[j]], Array<number>(n).fill(0),
        [...Array<number>(rank).fill(.2), .001]);
      w[j] = beta.slice(0, rank); bias[j] = beta[rank];
    }
    history.push(objective());
  }
  const probabilities = x.map((row, i) => row.map((_, j) => sigmoid(bias[j] + dot(z[i], w[j]))));
  return { scores: z, loadings: w, bias, probabilities, history };
}

/** Poisson y_i~Poisson(exposure_i exp(f_i)); exact dense prior, Laplace at Newton mode. */
export function poissonGPLaplace(kernel: Matrix, exposure: number[], counts: number[]) {
  const ki = inverseSPD(kernel), n = counts.length;
  let mode = Array<number>(n).fill(0);
  const objective = (f: number[]) => .5 * dot(f, mv(ki, f)) +
    sum(f.map((v, i) => exposure[i] * Math.exp(v) - counts[i] * v));
  const history = [objective(mode)];
  for (let step = 0; step < 40; step++) {
    const rates = mode.map((v, i) => exposure[i] * Math.exp(v));
    const gradient = mv(ki, mode).map((v, i) => v + rates[i] - counts[i]);
    if (Math.max(...gradient.map(Math.abs)) < 1e-8) break;
    const hessian = ki.map((row, i) => row.map((v, j) => v + (i === j ? rates[i] : 0)));
    const direction = solve(hessian, gradient), before = objective(mode);
    let accepted = false;
    for (let rate = 1; rate > 1e-9; rate *= .5) {
      const next = mode.map((v, i) => v - rate * direction[i]);
      if (objective(next) <= before + 1e-12) {
        mode = next; accepted = true; break;
      }
    }
    if (!accepted) break;
    history.push(objective(mode));
  }
  const rates = mode.map((v, i) => exposure[i] * Math.exp(v));
  const hessian = ki.map((row, i) => row.map((v, j) => v + (i === j ? rates[i] : 0)));
  const posteriorCovariance = inverseSPD(hessian);
  const gradient = mv(ki, mode).map((v, i) => v + rates[i] - counts[i]);
  return { mode, rates, posteriorCovariance, hessian, gradient, history };
}

/** Correlation average-linkage, retaining actual binary merge nodes for a dendrogram. */
export function averageLinkage(x: Matrix, clusters: number) {
  const standardized = x.map(row => {
    const m = mean(row), centered = row.map(v => v - m), scale = norm(centered);
    return centered.map(v => v / Math.max(1e-12, scale));
  });
  const distance = standardized.map(a => standardized.map(b => 1 - dot(a, b)));
  let groups = range(x.length).map(i => ({ members: [i], id: i }));
  const merges: { left: number; right: number; height: number; id: number }[] = [];
  let cut: number[][] = clusters === x.length ? groups.map(g => g.members) : [];
  while (groups.length > 1) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const value = mean(groups[i].members.flatMap(a => groups[j].members.map(b => distance[a][b])));
      if (value < best) { best = value; bi = i; bj = j; }
    }
    const a = groups[bi], b = groups[bj], id = x.length + merges.length;
    merges.push({ left: a.id, right: b.id, height: best, id });
    groups = groups.filter((_, i) => i !== bi && i !== bj);
    groups.push({ id, members: [...a.members, ...b.members] });
    if (groups.length === clusters) cut = groups.map(g => g.members);
  }
  const labels = Array<number>(x.length).fill(0);
  cut.forEach((g, k) => g.forEach(i => { labels[i] = k; }));
  return { labels, merges, order: groups[0].members };
}
export function statisticalKmeans(x: Matrix, k: number, iterations = 40) {
  let centers = [x[0]];
  const distance = (a: number[], b: number[]) => sum(a.map((v, j) => (v - b[j]) ** 2));
  while (centers.length < k) {
    const distances = x.map(row => Math.min(...centers.map(c => distance(row, c))));
    centers.push(x[distances.indexOf(Math.max(...distances))]);
  }
  let labels = Array<number>(x.length).fill(0);
  const history: number[] = [];
  for (let step = 0; step < iterations; step++) {
    labels = x.map(row => {
      const ds = centers.map(c => distance(row, c));
      return ds.indexOf(Math.min(...ds));
    });
    centers = centers.map((old, c) => {
      const members = x.filter((_, i) => labels[i] === c);
      return members.length ? transpose(members).map(mean) : old;
    });
    history.push(sum(x.map((row, i) => distance(row, centers[labels[i]]))));
  }
  return { centers, labels, history };
}
export function adjustedRand(a: number[], b: number[]) {
  const choose2 = (n: number) => n * (n - 1) / 2;
  const pairs = new Map<string, number>(), ac = new Map<number, number>(), bc = new Map<number, number>();
  a.forEach((v, i) => {
    const key = `${v}/${b[i]}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    ac.set(v, (ac.get(v) ?? 0) + 1); bc.set(b[i], (bc.get(b[i]) ?? 0) + 1);
  });
  const both = sum([...pairs.values()].map(choose2));
  const left = sum([...ac.values()].map(choose2)), right = sum([...bc.values()].map(choose2));
  const expected = left * right / choose2(a.length), maximum = (left + right) / 2;
  return maximum === expected ? 1 : (both - expected) / (maximum - expected);
}

/** Shared-observation kNN: numeric squared distance, categorical mismatch, no truth access. */
export function mixedKnnImpute(masked: Matrix, categorical: boolean[], neighbors: number) {
  const d = masked[0].length;
  const aggregate = (values: number[], discrete: boolean) => {
    if (!values.length) return 0;
    if (!discrete) return mean(values);
    const counts = new Map<number, number>();
    values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };
  const baseline = range(d).map(j => aggregate(masked.map(row => row[j]).filter(Number.isFinite), categorical[j]));
  return masked.map((row, i) => row.map((v, j) => {
    if (Number.isFinite(v)) return v;
    const donors = masked.map((other, index) => {
      const shared = range(d).filter(c => c !== j && Number.isFinite(row[c]) && Number.isFinite(other[c]));
      return { index, distance: !shared.length ? Infinity : mean(shared.map(c =>
        categorical[c] ? +(row[c] !== other[c]) : (row[c] - other[c]) ** 2)) };
    }).filter(donor => donor.index !== i && Number.isFinite(masked[donor.index][j]) && Number.isFinite(donor.distance))
      .sort((a, b) => a.distance - b.distance || a.index - b.index).slice(0, neighbors);
    return donors.length ? aggregate(donors.map(donor => masked[donor.index][j]), categorical[j]) : baseline[j];
  }));
}
export function lowRankImpute(masked: Matrix, rank: number, iterations = 45) {
  const mu = transpose(masked).map(col => {
    const values = col.filter(Number.isFinite);
    return values.length ? mean(values) : 0;
  });
  let filled = masked.map(row => row.map((v, j) => Number.isFinite(v) ? v : mu[j]));
  const history: number[] = [];
  for (let step = 0; step < iterations; step++) {
    const projection = statisticalPca(filled, rank).reconstructed;
    history.push(mean(masked.flatMap((row, i) => row.flatMap((v, j) => Number.isFinite(v) ? [(v - projection[i][j]) ** 2] : []))));
    filled = masked.map((row, i) => row.map((v, j) => Number.isFinite(v) ? v : projection[i][j]));
  }
  return { filled, history };
}

/** Mean-field Bernoulli block posterior with fixed planted/background probabilities. */
export function bernoulliBicluster(x: Matrix, background = .04, foreground = .92, prior = .3) {
  const n = x.length, d = x[0].length, priorLogit = Math.log(prior / (1 - prior));
  const evidence = x.map(row => row.map(v => v * Math.log(foreground / background) +
    (1 - v) * Math.log((1 - foreground) / (1 - background))));
  let rows = x.map(row => sigmoid(30 * (mean(row) - .18)));
  let columns = Array<number>(d).fill(prior);
  const entropy = (p: number) => -p * Math.log(Math.max(1e-15, p)) - (1 - p) * Math.log(Math.max(1e-15, 1 - p));
  const bound = () => sum(evidence.map((row, i) => sum(row.map((v, j) => rows[i] * columns[j] * v)))) +
    sum([...rows, ...columns].map(p => p * Math.log(prior) + (1 - p) * Math.log(1 - prior) + entropy(p)));
  const history = [bound()];
  for (let step = 0; step < 40; step++) {
    columns = range(d).map(j => sigmoid(priorLogit + sum(range(n).map(i => rows[i] * evidence[i][j]))));
    rows = range(n).map(i => sigmoid(priorLogit + dot(columns, evidence[i])));
    history.push(bound());
  }
  return { rows, columns, history };
}

const define = (id: string, title: string, method: string, description: string, differences: string[],
  run: (seed: number) => ExperimentResult): Reproduction => ({
  id, title, source: `demos/${id}.m`, method, description, differences, run,
});
const syntheticNote = 'Seeded synthetic data, not measurements from the named original benchmark.';

function maskData(x: Matrix, probability: number, rng: () => number) {
  const masked = x.map(row => row.map(v => rng() < probability ? NaN : v));
  // Preserve at least one observed value in every row/column for all methods.
  masked.forEach((row, i) => { if (row.every(Number.isNaN)) row[0] = x[i][0]; });
  range(x[0].length).forEach(j => {
    if (masked.every(row => Number.isNaN(row[j]))) masked[0][j] = x[0][j];
  });
  return masked;
}
const heldOut = (truth: Matrix, masked: Matrix, prediction: Matrix) =>
  truth.flatMap((row, i) => row.flatMap((v, j) => Number.isNaN(masked[i][j]) ? [[v, prediction[i][j], j]] : []));
const observedPreserved = (masked: Matrix, prediction: Matrix) =>
  masked.every((row, i) => row.every((v, j) => Number.isNaN(v) || v === prediction[i][j]));
const supportF1 = (truth: boolean[], selected: boolean[]) => {
  const tp = sum(truth.map((v, i) => +(v && selected[i])));
  const denom = sum(truth.map(Number)) + sum(selected.map(Number));
  return denom ? 2 * tp / denom : 1;
};
function syntheticProfiles(seed: number, n = 60) {
  const rng = seededRandom(seed), times = range(12).map(i => i / 11);
  const templates = [
    times.map(t => Math.sin(2 * Math.PI * t)),
    times.map(t => Math.cos(2 * Math.PI * t)),
    times.map(t => 2 * t - 1),
  ];
  const labels = range(n).map(i => i % 3);
  const data = labels.map(k => {
    const amplitude = 1 + .2 * normal(rng), offset = .1 * normal(rng);
    return templates[k].map(v => offset + amplitude * v + .12 * normal(rng));
  });
  return { data, times, labels };
}
function runBicluster(seed: number): ExperimentResult {
  const rng = seededRandom(seed), n = 48, d = 24;
  const rowTruth = range(n).map(i => i % 4 === 1), colTruth = range(d).map(j => j % 3 === 1);
  const data = range(n).map(i => range(d).map(j => +(rng() < (rowTruth[i] && colTruth[j] ? .92 : .04))));
  const fit = bernoulliBicluster(data), rowSelected = fit.rows.map(p => p > .5), colSelected = fit.columns.map(p => p > .5);
  const rowF1 = supportF1(rowTruth, rowSelected), columnF1 = supportF1(colTruth, colSelected);
  const rows = range(n).sort((a, b) => fit.rows[b] - fit.rows[a]);
  const cols = range(d).sort((a, b) => fit.columns[b] - fit.columns[a]);
  return {
    plots: [
      matrixPlot('Synthetic noisy binary planted block', data),
      matrixPlot('Variational joint row/column membership q(row)q(column)', fit.rows.map(p => fit.columns.map(q => p * q))),
      matrixPlot('Data reordered by inferred membership (not truth)', rows.map(i => cols.map(j => data[i][j]))),
      curve('Bernoulli block evidence lower bound (constant omitted)', [line('ELBO', range(fit.history.length), fit.history)], 'Coordinate iteration', 'ELBO'),
    ],
    metrics: { dataset: 'Synthetic 48 × 24 Bernoulli block', rowF1, columnF1,
      selectedRows: sum(rowSelected.map(Number)), selectedColumns: sum(colSelected.map(Number)),
      elboGain: fit.history.at(-1)! - fit.history[0] },
    checks: [
      check('Coordinate updates increase the same ELBO', monotone(fit.history)),
      check('Planted row membership recovered', rowF1 >= .85, `F1=${rowF1.toFixed(3)}`),
      check('Planted column membership recovered', columnF1 >= .85, `F1=${columnF1.toFixed(3)}`),
      check('Membership probabilities are normalized Bernoulli parameters', [...fit.rows, ...fit.columns].every(v => v >= 0 && v <= 1)),
    ],
    notes: ['Membership probabilities are mean-field approximations under fixed likelihood parameters, not Gibbs samples or calibrated empirical frequencies.'],
  };
}
function runBinaryEmbedding(seed: number): ExperimentResult {
  const rng = seededRandom(seed), d = 18, n = 120;
  const trueLoadings = range(d).map(j => {
    const theta = 2 * Math.PI * Math.floor(j / 6) / 3;
    return [2.4 * Math.cos(theta), 2.4 * Math.sin(theta)];
  });
  const data = range(n).map(() => {
    const latent = [normal(rng), normal(rng)];
    return trueLoadings.map(w => +(rng() < sigmoid(-.7 + dot(latent, w))));
  });
  const fit = logisticMatrixFactorization(data, seed ^ 374), colMeans = transpose(data).map(mean);
  const logLoss = (probs: Matrix) => -mean(data.flatMap((row, i) => row.map((v, j) =>
    v * Math.log(Math.max(1e-12, probs[i][j])) + (1 - v) * Math.log(Math.max(1e-12, 1 - probs[i][j])))));
  const baseline = logLoss(data.map(() => colMeans)), fitted = logLoss(fit.probabilities);
  return {
    plots: [
      curve('Synthetic word loadings: penalized logistic factorization', range(3).map(k => {
        const w = fit.loadings.filter((_, j) => Math.floor(j / 6) === k);
        return scatter(`Synthetic vocabulary group ${k + 1}`, w.map(v => v[0]), w.map(v => v[1]));
      }), 'Loading 1 (arbitrary rotation)', 'Loading 2'),
      matrixPlot('Fitted document/word Bernoulli probabilities', fit.probabilities.slice(0, 40)),
      curve('Penalized training objective', [line('Negative joint log posterior', range(fit.history.length), fit.history)], 'Alternating Newton sweep', 'Objective'),
      curve('Training reconstruction log loss (not evidence or held-out accuracy)',
        [bars('Nats per binary cell', ['Independent marginals', 'Rank-2 MAP'], [baseline, fitted])]),
    ],
    metrics: { dataset: 'Synthetic 120 documents × 18 binary words', rank: 2,
      independentTrainingLogLoss: baseline, factorizedTrainingLogLoss: fitted,
      objectiveDecrease: fit.history[0] - fit.history.at(-1)! },
    checks: [
      check('Alternating block Newton steps decrease the penalized objective', monotone(fit.history, false)),
      check('Rank-2 reconstruction captures word co-occurrence', fitted < baseline - .07),
      check('All fitted Bernoulli probabilities are strictly interior', fit.probabilities.flat().every(p => p > 0 && p < 1)),
    ],
    notes: ['This is MAP logistic matrix factorization, not marginal-maximum-likelihood FA or a JJ/Böhning variational bound. Loading axes have arbitrary rotation/sign; vocabulary groups are generator labels used only for display.'],
  };
}
function runBolasso(seed: number): ExperimentResult {
  const rng = seededRandom(seed), n = 110, p = 12, boots = 24;
  const truth = [1.7, -1.5, 1.2, ...Array<number>(p - 3).fill(0)];
  const raw = range(n).map(() => {
    const common = normal(rng);
    return range(p).map(() => .35 * common + normal(rng));
  });
  const centered = center(raw).data, sd = transpose(centered).map(col => Math.sqrt(mean(col.map(v => v * v))));
  const x = centered.map(row => row.map((v, j) => v / sd[j]));
  const y = center(x.map(row => [dot(row, truth) + .65 * normal(rng)])).data.map(row => row[0]);
  const lambdas = [.025, .06, .12, .24, .45];
  const bootstrapIndices = range(boots).map(() => range(n).map(() => Math.floor(rng() * n)));
  const frequencies: Matrix = [], intersections: Matrix = [], lassoSelections: Matrix = [];
  let nested = true;
  for (const lambda of lambdas) {
    const original = statisticalLasso(x, y, Array<number>(p).fill(lambda));
    const supports = bootstrapIndices.map(indices => statisticalLasso(indices.map(i => x[i]), indices.map(i => y[i]),
      Array<number>(p).fill(lambda)).map(v => Math.abs(v) > 1e-6));
    const frequency = range(p).map(j => mean(supports.map(row => +row[j])));
    const intersection = frequency.map(v => +(v === 1));
    nested &&= intersection.every((v, j) => !v || supports.slice(0, 4).every(row => row[j]));
    frequencies.push(frequency); intersections.push(intersection);
    lassoSelections.push(original.map(v => +(Math.abs(v) > 1e-6)));
  }
  const relevant = truth.map(v => v !== 0), best = 2;
  const lassoF1 = lassoSelections.map(row => supportF1(relevant, row.map(Boolean)));
  const bolassoF1 = intersections.map(row => supportF1(relevant, row.map(Boolean)));
  return {
    plots: [
      matrixPlot('Lasso support: rows are increasing lambda, columns are features', lassoSelections),
      matrixPlot('Actual bootstrap selection frequencies (24 resamples)', frequencies),
      matrixPlot('Strict Bolasso support intersection (frequency = 1)', intersections),
      curve('Support recovery on this single synthetic dataset', [
        line('Lasso F1', lambdas, lassoF1), line('Bolasso F1', lambdas, bolassoF1),
      ], 'Lambda in SSE/(2n) + lambda ||w||₁', 'Support F1'),
    ],
    metrics: { dataset: 'Synthetic correlated 110 × 12 regression; 3 relevant features', bootstraps: boots,
      lambdaShown: lambdas[best], lassoF1: lassoF1[best], bolassoF1: bolassoF1[best],
      lassoSelected: sum(lassoSelections[best]), bolassoSelected: sum(intersections[best]) },
    checks: [
      check('Strict intersection equals all bootstrap selections', frequencies.every((row, i) => row.every((v, j) => intersections[i][j] === +(v === 1)))),
      check('Adding bootstraps cannot expand strict consensus support', nested),
      check('Strong planted effects survive consensus at lambda 0.12', intersections[best].slice(0, 3).every(v => v === 1)),
      check('Consensus removes or retains, never adds, bootstrap-union features', intersections.every((row, i) => row.every((v, j) => !v || frequencies[i][j] > 0))),
    ],
    notes: ['Support F1 is measured against planted truth; selection frequency is not P(correct support) over repeated datasets. Bootstrap rows retain training centering/scaling.'],
  };
}
function runClustering(seed: number): ExperimentResult {
  const { data, times, labels: truth } = syntheticProfiles(seed, 48);
  const normalized = data.map(row => {
    const m = mean(row), sd = Math.sqrt(mean(row.map(v => (v - m) ** 2)));
    return row.map(v => (v - m) / sd);
  });
  const hierarchy = averageLinkage(normalized, 3), km = statisticalKmeans(normalized, 3);
  const hAri = adjustedRand(truth, hierarchy.labels), kAri = adjustedRand(truth, km.labels);
  const positions = new Map<number, [number, number]>();
  hierarchy.order.forEach((id, i) => positions.set(id, [i, 0]));
  const branches = hierarchy.merges.map(merge => {
    const a = positions.get(merge.left)!, b = positions.get(merge.right)!;
    positions.set(merge.id, [(a[0] + b[0]) / 2, merge.height]);
    return line(`Merge ${merge.id - data.length + 1}`,
      [a[0], a[0], b[0], b[0]], [a[1], merge.height, merge.height, b[1]]);
  });
  return {
    plots: [
      matrixPlot('Synthetic expression profiles ordered by average-linkage leaves', hierarchy.order.map(i => normalized[i])),
      curve('Correlation-distance average-linkage dendrogram', branches, 'Leaf position', '1 − correlation'),
      curve('Euclidean k-means centroids of row-standardized profiles', km.centers.map((row, i) => line(`Cluster ${i + 1}`, times, row)), 'Synthetic time', 'Standardized expression'),
      curve('Agreement with planted groups (ARI, label-permutation invariant)',
        [bars('Adjusted Rand index', ['Average linkage', 'k-means'], [hAri, kAri])]),
    ],
    metrics: { dataset: 'Synthetic 48 profiles × 12 times; 3 planted programs', clusters: 3,
      averageLinkageARI: hAri, kmeansARI: kAri, kmeansSSE: km.history.at(-1)! },
    checks: [
      check('Average-linkage heights are nondecreasing', monotone(hierarchy.merges.map(m => m.height))),
      check('k-means updates do not increase within-cluster SSE', monotone(km.history, false)),
      check('Both methods recover planted temporal programs', hAri > .8 && kAri > .8),
      check('Dendrogram has n−1 merges and each leaf once', hierarchy.merges.length === 47 && new Set(hierarchy.order).size === 48),
    ],
  };
}
function categoricalExperiment(seed: number, states: number): ExperimentResult {
  const rng = seededRandom(seed), d = states === 2 ? 12 : 9;
  const sample = (n: number) => range(n).map(() => {
    const group = Math.floor(rng() * 3);
    return range(d).map(j => {
      const target = states === 2 ? +(Math.floor(j / 4) === group) : (group + Math.floor(j / 3)) % states;
      if (rng() < .9) return target;
      const alternative = Math.floor(rng() * (states - 1));
      return alternative >= target ? alternative + 1 : alternative;
    });
  });
  const train = sample(240), test = sample(120), masked = maskData(test, .3, rng);
  const ks = [1, 2, 3], models = ks.map(k => fitCategoricalMixture(train, k, states, seed + k));
  const nll = models.map(model => -mean(test.map(row => categoricalPosterior(model, row).logProbability)));
  const ce: number[] = [], brier: number[] = [], errors: number[] = [];
  let maxNormalizationError = 0, missingCount = 0;
  models.forEach((model, m) => {
    let crossEntropy = 0, brierSum = 0, mistakes = 0, count = 0;
    test.forEach((row, i) => {
      const predictions = categoricalPredict(model, masked[i]);
      predictions.forEach(p => { maxNormalizationError = Math.max(maxNormalizationError, Math.abs(sum(p) - 1)); });
      row.forEach((v, j) => {
        if (!Number.isNaN(masked[i][j])) return;
        const probabilities = predictions[j];
        crossEntropy -= Math.log(probabilities[v]) / Math.LN2;
        brierSum += sum(probabilities.map((p, c) => (p - +(c === v)) ** 2));
        mistakes += +(probabilities.indexOf(Math.max(...probabilities)) !== v); count++;
      });
    });
    ce[m] = crossEntropy / count; brier[m] = brierSum / count; errors[m] = mistakes / count;
    missingCount = count;
  });
  const names = ['Independent (K=1)', 'Mixture K=2', 'Mixture K=3'];
  return {
    plots: [
      curve('Disjoint held-out joint negative log likelihood', [bars('Nats per complete row', names, nll)]),
      curve('Masked-cell prediction uses observed cells only', [bars('Bits per missing cell', names, ce)]),
      curve('Categorical Brier score and classification error on identical missing cells',
        [bars('Multiclass Brier', names, brier), bars('0/1 error', names, errors)]),
      matrixPlot(states === 2 ? 'Learned P(word present | mixture component)' : 'Learned P(category 0 | mixture component)',
        models[2].probabilities.map(component => component.map(p => p[states === 2 ? 1 : 0]))),
      curve('Exact-EM training observed log likelihood', models.map((model, i) =>
        line(names[i], range(model.history.length), model.history)), 'EM iteration', 'Nats'),
    ],
    metrics: { dataset: `Synthetic ${states}-category rows, 240 train / 120 test × ${d} variables`,
      missingCells: missingCount, independentTestNLL: nll[0], mixture3TestNLL: nll[2],
      independentMissingBits: ce[0], mixture3MissingBits: ce[2],
      mixture3Brier: brier[2], maxProbabilityNormalizationError: maxNormalizationError },
    checks: [
      check('Exact EM likelihood is nondecreasing', models.every(model => monotone(model.history, true, 1e-5))),
      check('Mixture weights and every conditional category distribution sum to one', models.every(model =>
        Math.abs(sum(model.weights) - 1) < 1e-10 && model.probabilities.flat().every(p => Math.abs(sum(p) - 1) < 1e-10))),
      check('Posterior predictions are normalized', maxNormalizationError < 1e-10),
      check('Learned dependence improves disjoint-test density', nll[2] < nll[0]),
      check('Learned dependence improves masked-cell cross entropy', ce[2] < ce[0]),
    ],
    notes: ['Training/test rows are independently generated. All models use the same test mask. Missing-cell cross entropy is divided by the number of missing cells, unlike the original Emt denominator Ntest × D. No categorical/binary FA likelihood is fabricated.'],
  };
}
function runFaBiplot(seed: number): ExperimentResult {
  const rng = seededRandom(seed);
  const truth = [[.9, .05], [.8, .1], [.85, -.05], [.02, .9], [.1, .8], [-.1, .85]];
  const psi = [.08, .25, .12, .1, .3, .14];
  const raw = range(220).map(() => {
    const z = [normal(rng), normal(rng)];
    return truth.map((w, j) => dot(w, z) + Math.sqrt(psi[j]) * normal(rng));
  });
  const c = center(raw), sd = transpose(c.data).map(col => Math.sqrt(mean(col.map(v => v ** 2))));
  const data = c.data.map(row => row.map((v, j) => v / sd[j]));
  const fit = maximumLikelihoodFA(data), s = covariance(data);
  const covarianceRmse = Math.sqrt(squaredError(s.flat(), fit.covariance.flat()));
  return {
    plots: [
      curve('Actual ML factor analysis: posterior scores and loadings', [
        scatter('E[z | x] (synthetic observations)', fit.scores.map(z => z[0]), fit.scores.map(z => z[1])),
        ...fit.loadings.map((w, j) => line(`Variable ${j + 1} loading`, [0, w[0]], [0, w[1]])),
      ], 'Factor 1 (arbitrary sign/rotation)', 'Factor 2'),
      curve('ML FA EM observed-data log likelihood', [line('Gaussian marginal log likelihood', range(fit.history.length), fit.history)], 'EM iteration', 'Nats'),
      curve('Estimated uniquenesses (diagonal noise, not PCA residual eigenvalues)',
        [bars('Psi diagonal', range(6).map(i => `Variable ${i + 1}`), fit.uniqueness)]),
      matrixPlot('Fitted covariance L Lᵀ + diag(Psi)', fit.covariance),
    ],
    metrics: { dataset: 'Synthetic standardized 220 × 6, two-factor heteroscedastic Gaussian data',
      factors: 2, logLikelihoodGain: fit.history.at(-1)! - fit.history[0],
      covarianceRMSE: covarianceRmse, minUniqueness: Math.min(...fit.uniqueness),
      uniquenessRange: Math.max(...fit.uniqueness) - Math.min(...fit.uniqueness) },
    checks: [
      check('Actual FA EM increases observed marginal likelihood', monotone(fit.history, true, 1e-6)),
      check('Positive, non-isotropic estimated uniquenesses', Math.min(...fit.uniqueness) > 0 && Math.max(...fit.uniqueness) - Math.min(...fit.uniqueness) > .05),
      check('Two-factor model fits empirical covariance', covarianceRmse < .08),
    ],
    notes: ['Six synthetic variables replace 11 continuous cars04 variables. Posterior means are regression factor scores. No varimax rotation; loading and score scales are distinct.'],
  };
}
function runGeneImputation(seed: number): ExperimentResult {
  const rng = seededRandom(seed), n = 84, d = 12;
  const times = range(d).map(j => j / (d - 1));
  const truth = range(n).map(() => {
    const z = [normal(rng), normal(rng)];
    return times.map(t => 1.2 * z[0] * Math.sin(2 * Math.PI * t) + z[1] * Math.cos(2 * Math.PI * t) +
      .3 * t + .08 * normal(rng));
  });
  const rates = [.1, .25], names = ['Row mean', 'Column mean', 'kNN 1', 'kNN 5', 'Iterative rank-2 PCA'];
  const errors: Matrix = [], nrmse: Matrix = [];
  let final: Matrix = [], maskedCount = 0, preserved = true;
  for (const probability of rates) {
    const masked = maskData(truth, probability, rng);
    const colMean = transpose(masked).map(col => mean(col.filter(Number.isFinite)));
    const rowMean = masked.map(row => mean(row.filter(Number.isFinite)));
    const predictions = [
      masked.map((row, i) => row.map(v => Number.isFinite(v) ? v : rowMean[i])),
      masked.map(row => row.map((v, j) => Number.isFinite(v) ? v : colMean[j])),
      mixedKnnImpute(masked, Array<boolean>(d).fill(false), 1),
      mixedKnnImpute(masked, Array<boolean>(d).fill(false), 5),
      lowRankImpute(masked, 2).filled,
    ];
    const entries = predictions.map(prediction => heldOut(truth, masked, prediction));
    errors.push(entries.map(cells => Math.sqrt(mean(cells.map(([v, p]) => (v - p) ** 2)))));
    nrmse.push(entries.map(cells => Math.sqrt(sum(cells.map(([v, p]) => (v - p) ** 2)) / sum(cells.map(([v]) => v ** 2)))));
    preserved &&= predictions.every(prediction => observedPreserved(masked, prediction));
    final = predictions[4]; maskedCount += entries[0].length;
  }
  return {
    plots: [
      curve('Held-out synthetic expression imputation RMSE', errors.map((row, i) =>
        bars(`${rates[i] * 100}% MCAR missing`, names, row))),
      curve('Original-style NRMSE = ||error_missing|| / ||truth_missing||', nrmse.map((row, i) =>
        bars(`${rates[i] * 100}% missing`, names, row))),
      matrixPlot('Synthetic complete expression (first 28 rows)', truth.slice(0, 28)),
      matrixPlot('Iterative PCA completion, 25% masked (first 28 rows)', final.slice(0, 28)),
    ],
    metrics: { dataset: 'Synthetic rank-2 noisy 84 × 12 expression profiles', evaluatedMissingCells: maskedCount,
      columnMeanRMSE25pct: errors[1][1], knn5RMSE25pct: errors[1][3], rank2RMSE25pct: errors[1][4],
      rank2NRMSE25pct: nrmse[1][4] },
    checks: [
      check('Only masked entries are changed by all five imputers', preserved),
      check('Low-rank completion beats column means at both missingness levels', errors.every(row => row[4] < row[1] * .6)),
      check('kNN captures similarity beyond column means', errors.every(row => row[3] < row[1])),
      check('Both masks contain nontrivial held-out entries', maskedCount > 200),
    ],
    notes: ['MCAR masks are generated before fitting; hidden truth is used only for scoring. Iterative PCA alternates rank-2 least-squares projection with clamping observed entries. Scores are one seeded mask per rate, not multi-trial boxplots or timing benchmarks.'],
  };
}
function runMixedImputation(seed: number): ExperimentResult {
  const rng = seededRandom(seed), n = 150, categorical = [false, false, true, true, true];
  const raw = range(n).map(() => {
    const z = Math.floor(rng() * 3);
    return [2 * (z - 1) + .35 * normal(rng), 1.4 * (z - 1) + .4 * normal(rng),
      rng() < .95 ? z : Math.floor(rng() * 3), +(rng() < (z === 1 ? .94 : .06)),
      rng() < .92 ? z : Math.floor(rng() * 3)];
  });
  const maskedRaw = maskData(raw, .2, rng);
  const mu = [0, 1].map(j => mean(maskedRaw.map(row => row[j]).filter(Number.isFinite)));
  const sd = [0, 1].map(j => Math.sqrt(mean(maskedRaw.map(row => row[j]).filter(Number.isFinite).map(v => (v - mu[j]) ** 2))));
  const scale = (x: Matrix) => x.map(row => row.map((v, j) => j < 2 ? (v - mu[j]) / sd[j] : v));
  const truth = scale(raw), masked = scale(maskedRaw);
  const baseline = range(5).map(j => {
    const values = masked.map(row => row[j]).filter(Number.isFinite);
    if (j < 2) return mean(values);
    const counts = range(j === 3 ? 2 : 3).map(c => sum(values.map(v => +(v === c))));
    return counts.indexOf(Math.max(...counts));
  });
  const predictions = [
    masked.map(row => row.map((v, j) => Number.isFinite(v) ? v : baseline[j])),
    ...[1, 5, 10].map(k => mixedKnnImpute(masked, categorical, k)),
  ];
  const names = ['Mean/mode', 'Mixed kNN 1', 'Mixed kNN 5', 'Mixed kNN 10'];
  const losses = predictions.map(prediction => {
    const cells = heldOut(truth, masked, prediction);
    const continuous = cells.filter(([, , j]) => !categorical[j]), discrete = cells.filter(([, , j]) => categorical[j]);
    const continuousMSE = mean(continuous.map(([v, p]) => (v - p) ** 2));
    const categoricalError = mean(discrete.map(([v, p]) => +(v !== p)));
    return { continuousMSE, categoricalError, mixed: .5 * (continuousMSE + categoricalError) };
  });
  const selected = heldOut(truth, masked, predictions[2]).filter(([, , j]) => j < 2);
  return {
    plots: [
      curve('Mixed-type imputation on 20% MCAR hidden cells', [
        bars('Standardized continuous RMSE', names, losses.map(l => Math.sqrt(l.continuousMSE))),
        bars('Categorical 0/1 error', names, losses.map(l => l.categoricalError)),
      ]),
      curve('Explicit mixed loss: 0.5 × (continuous MSE + categorical error)',
        [bars('Mixed loss', names, losses.map(l => l.mixed))]),
      curve('Hidden continuous values versus mixed-kNN-5 predictions', [
        scatter('Held-out cells', selected.map(c => c[0]), selected.map(c => c[1])),
        line('Identity', [-2.5, 2.5], [-2.5, 2.5]),
      ], 'Hidden standardized truth', 'Imputed value'),
    ],
    metrics: { dataset: 'Synthetic 150 rows, 2 continuous + 3 categorical columns; not UCI Adult',
      baselineMixedLoss: losses[0].mixed, knn5MixedLoss: losses[2].mixed,
      knn5ContinuousRMSE: Math.sqrt(losses[2].continuousMSE), knn5CategoricalError: losses[2].categoricalError,
      missingCells: heldOut(truth, masked, predictions[0]).length },
    checks: [
      check('Observed cells are unchanged by every imputer', predictions.every(prediction => observedPreserved(masked, prediction))),
      check('Categorical imputations stay in their legal category sets', predictions.every(prediction =>
        prediction.every(row => row.slice(2).every((v, j) => Number.isInteger(v) && v >= 0 && v < (j === 1 ? 2 : 3))))),
      check('Mixed kNN improves over marginal mean/mode', losses[2].mixed < losses[0].mixed),
      check('Continuous scales estimated without hidden values', sd.every(s => s > 0 && Number.isFinite(s))),
    ],
    notes: ['Distance averages squared standardized differences and categorical mismatch over shared observed columns. Donors must have an observed target. Continuous output is a donor mean; categorical output is a donor mode (not an averaged category code).'],
  };
}
function runSparseRegression(seed: number): ExperimentResult {
  const rng = seededRandom(seed), p = 24, n = 90, sigma = .45;
  const truth = range(p).map(j => ({ 1: 2, 6: -1.7, 12: 1.3, 19: -1 }[j] ?? 0));
  const sample = (count: number) => range(count).map(() => {
    let previous = normal(rng);
    return range(p).map((_, j) => { if (j) previous = .4 * previous + Math.sqrt(.84) * normal(rng); return previous; });
  });
  const raw = sample(n), ct = center(raw), sd = transpose(ct.data).map(col => Math.sqrt(mean(col.map(v => v ** 2))));
  const x = ct.data.map(row => row.map((v, j) => v / sd[j]));
  const xtest = sample(200).map(row => row.map((v, j) => (v - ct.mu[j]) / sd[j]));
  const yraw = x.map(row => dot(row, truth) + sigma * normal(rng)), muY = mean(yraw), y = yraw.map(v => v - muY);
  const ytest = xtest.map(row => dot(row, truth) + sigma * normal(rng) - muY);
  const em = studentTRegressionEM(x, y), scad = statisticalScad(x, y, .12);
  const lasso = statisticalLasso(x, y, Array<number>(p).fill(.12));
  const xt = transpose(x), xtx = multiply(xt, x);
  const ridge = solve(xtx.map((row, i) => row.map((v, j) => v + (i === j ? n * .12 : 0))), mv(xt, y));
  const names = ['Student-t EM', 'SCAD LLA', 'Lasso', 'Ridge'], weights = [em.weights, scad.weights, lasso, ridge];
  const testMSE = weights.map(w => squaredError(ytest, mv(xtest, w)));
  const nonzero = weights.map(w => sum(w.map(v => +(Math.abs(v) > .05))));
  const f1 = weights.map(w => supportF1(truth.map(v => v !== 0), w.map(v => Math.abs(v) > .05)));
  return {
    plots: [
      curve('Sparse coefficients: actual fitted alternatives on one dataset', [
        line('Planted truth', range(p), truth), ...weights.map((w, i) => line(names[i], range(p), w)),
      ], 'Feature index', 'Coefficient'),
      curve('Independent test prediction error', [bars('Test MSE (200 fresh rows)', names, testMSE)]),
      curve('Thresholded sparsity and support recovery', [
        bars('Number |w| > 0.05', names, nonzero), bars('Support F1', names, f1),
      ]),
      curve('Student-t latent-precision EM objective', [line('Negative log posterior (constant omitted)', range(em.history.length), em.history)], 'EM iteration'),
      curve('SCAD local-linear-approximation objective', [line('SSE/(2n) + actual SCAD penalty', range(scad.history.length), scad.history)], 'LLA iteration'),
    ],
    metrics: { dataset: 'Synthetic correlated 90 train / 200 test × 24 features; 4 planted effects',
      studentTTestMSE: testMSE[0], scadTestMSE: testMSE[1], lassoTestMSE: testMSE[2], ridgeTestMSE: testMSE[3],
      studentTSupportF1: f1[0], scadSupportF1: f1[1], fixedLambda: .12, fixedNoiseSD: sigma },
    checks: [
      check('Student-t precision-mixture EM decreases its actual objective', monotone(em.history, false, 1e-6)),
      check('SCAD reweighted Lasso decreases the actual nonconvex SCAD objective', monotone(scad.history, false, 1e-6)),
      check('Large SCAD coefficients have zero penalty derivative', scad.weights.filter(v => Math.abs(v) > 3.7 * .12).length >= 3 &&
        scad.weights.filter(v => Math.abs(v) > 3.7 * .12).every(v => scadDerivative(v, .12) === 0)),
      check('Student-t and SCAD recover strong planted support', f1[0] >= .75 && f1[1] >= .75),
      check('Sparse fits predict better than a zero coefficient vector', testMSE[0] < mean(ytest.map(v => v * v)) && testMSE[1] < mean(ytest.map(v => v * v))),
    ],
    notes: ['Student-t is a proper Gaussian-Gamma precision-mixture EM alternative, not the original NJ/NG/NEG priors. Noise and all penalties are fixed before evaluation; no test-set tuning or cross-validation claims. Coefficients below 0.05 are counted as practically zero; Student-t MAP has no exact zeros.'],
  };
}

/** Separate intercepts; empirical common-mean Gaussian prior on slopes only. */
export function fitTaskShrinkage(x: number[], y: Matrix, precision: number) {
  const mx = mean(x), centered = x.map(v => v - mx), sxx = dot(centered, centered);
  const means = transpose(y).map(mean);
  const sxy = means.map((m, t) => dot(centered, y.map(row => row[t] - m)));
  const separate = sxy.map(v => v / (sxx + .001));
  const common = mean(separate), pooled = sxy.map(v => (v + precision * common) / (sxx + precision));
  return {
    separate, pooled, common, sxx, sxy,
    separateIntercepts: means.map((m, t) => m - mx * separate[t]),
    pooledIntercepts: means.map((m, t) => m - mx * pooled[t]),
  };
}
function runMultitask(seed: number): ExperimentResult {
  const rng = seededRandom(seed), sizes = [4, 8, 16, 32], tasks = 10, precision = 36;
  const grid = range(61).map(i => -2 + i / 15), plots: VisualPlot[] = [];
  const metrics: Record<string, number | string> = { dataset: 'Synthetic 1D regression, 10 tasks; separate intercepts', priorPrecision: precision };
  let equationsHold = true, shrinkageHolds = true, maxInterceptResidual = 0;
  for (const heterogeneous of [false, true]) {
    const truth = range(tasks).map(t => (heterogeneous ? (t % 2 ? -2 : 2) : 2) + .1 * normal(rng));
    const intercepts = range(tasks).map(() => 2 * normal(rng));
    const x = range(32).map(() => normal(rng));
    const y = x.map(v => truth.map((w, t) => intercepts[t] + v * w + 1.5 * normal(rng)));
    const separateRisk: number[] = [], pooledRisk: number[] = [];
    let last = fitTaskShrinkage(x, y, precision);
    for (const n of sizes) {
      const fit = fitTaskShrinkage(x.slice(0, n), y.slice(0, n), precision);
      const risk = (weights: number[], bias: number[]) => mean(truth.map((w, t) =>
        mean(grid.map(v => (bias[t] + weights[t] * v - (intercepts[t] + w * v)) ** 2))));
      separateRisk.push(risk(fit.separate, fit.separateIntercepts));
      pooledRisk.push(risk(fit.pooled, fit.pooledIntercepts));
      equationsHold &&= fit.pooled.every((w, t) => Math.abs((fit.sxx + precision) * w - fit.sxy[t] - precision * fit.common) < 1e-8);
      shrinkageHolds &&= sum(fit.pooled.map(w => (w - fit.common) ** 2)) <= sum(fit.separate.map(w => (w - fit.common) ** 2)) + 1e-8;
      for (let t = 0; t < tasks; t++) {
        maxInterceptResidual = Math.max(maxInterceptResidual,
          Math.abs(mean(y.slice(0, n).map((row, i) => row[t] - fit.pooledIntercepts[t] - x[i] * fit.pooled[t]))),
          Math.abs(mean(y.slice(0, n).map((row, i) => row[t] - fit.separateIntercepts[t] - x[i] * fit.separate[t]))));
      }
      last = fit;
    }
    const scenario = heterogeneous ? 'Heterogeneous slopes (negative-transfer risk)' : 'Related slopes';
    plots.push(curve(`${scenario}: error against noiseless test functions`, [
      line('Separate ridge-stabilized OLS', sizes, separateRisk), line('Common-mean Gaussian MAP', sizes, pooledRisk),
    ], 'Training rows per task', 'Noiseless-function MSE'));
    plots.push(curve(`${scenario}: slopes at N=32`, [
      scatter('Truth', range(tasks), truth), scatter('Separate', range(tasks), last.separate), scatter('Pooled MAP', range(tasks), last.pooled),
    ], 'Task', 'Slope'));
    const prefix = heterogeneous ? 'heterogeneous' : 'related';
    metrics[`${prefix}SeparateMSE4`] = separateRisk[0]; metrics[`${prefix}PooledMSE4`] = pooledRisk[0];
    metrics[`${prefix}SeparateMSE32`] = separateRisk.at(-1)!; metrics[`${prefix}PooledMSE32`] = pooledRisk.at(-1)!;
    metrics[`${prefix}TransferRatio32`] = pooledRisk.at(-1)! / separateRisk.at(-1)!;
  }
  metrics.maxInterceptNormalEquationResidual = maxInterceptResidual;
  return {
    plots, metrics,
    checks: [
      check('Every pooled slope satisfies its Gaussian MAP normal equation', equationsHold),
      check('Common-mean prior shrinks cross-task slope dispersion', shrinkageHolds),
      check('Every separate task intercept has zero mean residual', maxInterceptResidual < 1e-10,
        `Maximum |mean residual|=${maxInterceptResidual.toExponential(2)}; intercepts are unpenalized.`),
    ],
    notes: ['The prior mean is estimated from the separate fits. Fixed prior precision 36 corresponds to known noise variance 2.25 and prior slope variance 0.0625. Pooling is not guaranteed to improve prediction; the heterogeneous scenario exposes possible negative transfer.'],
  };
}
function runPcaProfiles(seed: number): ExperimentResult {
  const { data, times } = syntheticProfiles(seed, 90), fit = statisticalPca(data);
  const explained = fit.values.map(v => v / sum(fit.values));
  const cumulative = explained.map((_, i) => sum(explained.slice(0, i + 1)));
  const ranks = [1, 2, 3, 6, 12], reconstructionErrors = ranks.map(k =>
    Math.sqrt(squaredError(data.flat(), fit.reconstruction(k).flat())));
  const eigenResidual = Math.max(...fit.vectors.map((v, k) => norm(mv(fit.covariance, v).map((c, j) => c - fit.values[k] * v[j]))));
  return {
    plots: [
      curve('Synthetic expression PCA variance spectrum', [
        { ...line('Per-component fraction', range(12).map(i => i + 1), explained), mode: 'lines+markers' },
        line('Cumulative fraction', range(12).map(i => i + 1), cumulative),
      ], 'Principal component', 'Explained variance fraction'),
      curve('First three principal temporal bases', fit.vectors.slice(0, 3).map((v, k) => line(`PC ${k + 1}`, times, v)), 'Synthetic time', 'Unit-norm component'),
      curve('First two PCA scores', [scatter('Synthetic profiles', fit.scores.map(v => v[0]), fit.scores.map(v => v[1]))], 'PC 1 score', 'PC 2 score'),
      curve('Rank truncation reconstruction error', [line('RMSE over all entries', ranks, reconstructionErrors)], 'Retained components', 'RMSE'),
      curve('One profile: observed versus two-component reconstruction', [
        line('Profile 0', times, data[0]), line('Rank-2 approximation', times, fit.reconstructed[0]),
      ], 'Synthetic time', 'Expression'),
    ],
    metrics: { dataset: 'Synthetic 90 expression profiles × 12 times; not yeast measurements',
      firstTwoExplainedVariance: cumulative[1], rank2RMSE: reconstructionErrors[1],
      fullRankRMSE: reconstructionErrors.at(-1)!, eigenResidual },
    checks: [
      check('Eigenpairs satisfy covariance eigen-equations', eigenResidual < 1e-8),
      check('Variance fractions sum to one', Math.abs(sum(explained) - 1) < 1e-10),
      check('Reconstruction error cannot increase with retained rank', monotone(reconstructionErrors, false)),
      check('Full-rank reconstruction is numerically exact', reconstructionErrors.at(-1)! < 1e-8),
      check('First two components retain dominant temporal structure', cumulative[1] > .8),
    ],
    notes: ['Population covariance (divide by N) matches pcaPmtk. Profiles are centered across rows, not row-standardized. Static profile 0 replaces interactive point picking; the original seven-basis yeast display is bounded to three bases.'],
  };
}
function runSpatialGP(seed: number): ExperimentResult {
  const rng = seededRandom(seed), side = 6;
  const locations = range(side * side).map(i => [i % side / (side - 1), Math.floor(i / side) / (side - 1)]);
  const exposure = locations.map(([, y]) => y > .5 ? 2 : 16);
  const trueLogRisk = locations.map(([x, y]) => .65 * (x - .5) + .25 * Math.cos(2 * Math.PI * y));
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let product = 1, k = 0;
    do { product *= rng(); k++; } while (product > limit);
    return k - 1;
  };
  const counts = exposure.map((e, i) => poisson(e * Math.exp(trueLogRisk[i])));
  const kernel = locations.map((a, i) => locations.map((b, j) => {
    const distance = Math.sqrt(3) * Math.hypot(a[0] - b[0], a[1] - b[1]) / .45;
    return .4 * (1 + distance) * Math.exp(-distance) + (i === j ? .01 : 0);
  }));
  const fit = poissonGPLaplace(kernel, exposure, counts);
  const variances = fit.posteriorCovariance.map((row, i) => row[i]);
  // These are lognormal moments under the Laplace Gaussian, not exp(mode) mislabeled as a mean.
  const riskMean = fit.mode.map((v, i) => Math.exp(v + variances[i] / 2));
  const riskSD = fit.mode.map((v, i) => Math.sqrt((Math.exp(variances[i]) - 1) * Math.exp(2 * v + variances[i])));
  const spatial = (title: string, values: number[]): VisualPlot => ({
    title, xLabel: 'Synthetic east coordinate', yLabel: 'Synthetic north coordinate',
    traces: [{ name: title, type: 'scatter', mode: 'markers', x: locations.map(v => v[0]), y: locations.map(v => v[1]),
      marker: { symbol: 'square', size: 23, color: values, colorscale: 'Viridis', showscale: true } }],
  });
  const lowVariance = mean(variances.filter((_, i) => exposure[i] === 2));
  const highVariance = mean(variances.filter((_, i) => exposure[i] === 16));
  const gradient = Math.max(...fit.gradient.map(Math.abs));
  return {
    plots: [
      spatial('Synthetic crude risk: count / exposure', counts.map((y, i) => y / exposure[i])),
      spatial('Laplace posterior mean relative risk (lognormal moment)', riskMean),
      spatial('Laplace posterior standard deviation of relative risk', riskSD),
      spatial('Planted synthetic relative risk', trueLogRisk.map(Math.exp)),
      curve('Non-Gaussian Poisson posterior mode objective', [line('Negative log posterior (constant omitted)', range(fit.history.length), fit.history)], 'Damped Newton iteration'),
    ],
    metrics: { dataset: 'Synthetic 6 × 6 spatial grid; Poisson counts and population exposures',
      maxPosteriorGradient: gradient, meanLowExposureLogVariance: lowVariance,
      meanHighExposureLogVariance: highVariance, posteriorRiskRMSE: Math.sqrt(squaredError(trueLogRisk.map(Math.exp), riskMean)),
      posteriorObjectiveDecrease: fit.history[0] - fit.history.at(-1)! },
    checks: [
      check('Newton iteration decreases the actual Poisson posterior objective', monotone(fit.history, false)),
      check('Non-Gaussian posterior mode is stationary', gradient < 1e-6),
      check('Laplace covariance has positive diagonals bounded by prior variance', variances.every((v, i) => v > 0 && v < kernel[i][i])),
      check('Low exposure cells retain more log-risk uncertainty', lowVariance > highVariance),
      check('Poisson curvature differs from fixed Gaussian noise', Math.max(...fit.rates) - Math.min(...fit.rates) > 1),
    ],
    notes: ['No Finland health data are used. Dense Matérn-3/2 covariance replaces FIC inducing points; length scale 0.45 and variance 0.4 are fixed, not hyperparameter MAP estimates. Reported risk moments use the Laplace approximation and are not exact posterior integrals.'],
  };
}

export const statisticalReproductions: Reproduction[] = [
  define('biclusterDemo', 'Discovering a noisy synthetic bicluster',
    'Mean-field Bernoulli block posterior (coordinate-ascent variational inference)',
    'Jointly infer row and column membership and reorder a noisy planted binary block.',
    [syntheticNote, 'One 48×24 binary block replaces the binary, three-level and overlapping multi-block suites.',
      'Deterministic mean-field updates with disclosed fixed p(background)=0.04, p(block)=0.92 and membership prior 0.3 replace biclusteringGibbs. No MCMC posterior claim.'], runBicluster),
  define('binaryFaDemoNewsgroups', 'Binary word co-occurrence embedding',
    'Rank-2 MAP logistic matrix factorization by alternating damped Newton steps',
    'Learn two-dimensional word loadings from synthetic binary document co-occurrences.',
    [syntheticNote, '120 documents and 18 synthetic words replace 5,000 sampled 20 Newsgroups documents with 100 words.',
      'Joint MAP factorization substitutes for JJ/Böhning variational binary/categorical FA; it is not ML Gaussian FA or marginal-likelihood binary FA.',
      'Rank is already two, so no high-dimensional delta-function embeddings, MDS, K=10/50 comparison, or runtime benchmark. Training reconstruction loss is labeled as such.'], runBinaryEmbedding),
  define('bolassoDemo', 'Bootstrap consensus for sparse support',
    'Lasso coordinate descent and strict Bolasso bootstrap support intersection',
    'Compare ordinary sparse support with frequencies and strict consensus over actual row bootstraps.',
    [syntheticNote, 'One 110×12 correlated design, five penalties and 24 bootstraps replace 256 datasets, two consistency regimes, 16 features and up to 256 bootstraps.',
      'Fixed training standardization and SSE/(2n) penalty convention; no reproduction of Bach consistency curves or P(correct support).'], runBolasso),
  define('clusterYeast', 'Clustering synthetic temporal expression',
    'Correlation average-linkage hierarchical clustering and standardized Euclidean k-means',
    'Compare a real average-linkage dendrogram with k-means centroids and planted-program recovery.',
    [syntheticNote, '48 generated profiles at 12 times with three groups replace yeastData310 and 16 clusters.',
      'Average linkage and k-means are implemented; single/complete-link comparisons and a toolbox clustergram UI are omitted.',
      'K-means uses row-standardized data for shape comparison rather than the original raw-data Euclidean call.'], runClustering),
  define('emtShootout', 'Categorical density and imputation shootout',
    'Exact EM product-categorical mixtures K=1,2,3 and posterior missing-category prediction',
    'Compare marginal independence with latent-class dependence on held-out four-category observations.',
    [syntheticNote, 'Four-state synthetic data (240 train,120 test,9 variables) replace the ases4 survey benchmark.',
      'K=1,2,3 mixtures replace K=1,5,10,20,40 and the categorical-FA suite; omitted models receive no invented score.',
      'Missing cross entropy is bits per missing cell, not original bits divided by all test cells. Timing and multi-fold benchmarks are omitted.'], seed => categoricalExperiment(seed, 4)),
  define('faBiplotDemo', 'Maximum-likelihood factor-analysis biplot',
    'Gaussian maximum-likelihood factor analysis via EM with diagonal uniquenesses',
    'Fit a two-factor heteroscedastic latent Gaussian model and visualize actual posterior scores and loadings.',
    [syntheticNote, '220×6 standardized two-factor observations replace cars04 387×11 continuous measurements.',
      'A direct EM likelihood fit replaces the factoran toolbox; no varimax rotation or interactive variable labels.',
      'Initialization uses covariance eigenvectors, but all subsequent updates optimize the FA marginal likelihood with separately estimated diagonal uniquenesses, not PCA.'], runFaBiplot),
  define('imputationGeneMicroarrayDemo', 'Imputing synthetic expression arrays',
    'Row/column means, shared-coordinate kNN, and iterative rank-2 PCA completion',
    'Mask known synthetic expression values and compare actual held-out RMSE and original-style NRMSE.',
    [syntheticNote, '84×12 low-rank profiles and 10%/25% MCAR missingness replace yeast stress/cell-cycle arrays, 1%/10% missingness and repeated trials.',
      'Iterative PCA completion is an explicit substitute for mixGauss1 conditional imputation; no Gaussian-mixture EM claim.',
      'Single seeded masks and bar charts replace repeated-trial boxplots; nondeterministic wall-clock timing is intentionally not reported.'], runGeneImputation),
  define('imputationMixedAdultDemo', 'Mixed-type imputation without category averaging',
    'Mixed-distance kNN with numeric means and categorical modes',
    'Evaluate standardized numeric errors and categorical mistakes using only observed donor coordinates.',
    [syntheticNote, '150 generated rows with two continuous and three categorical columns replace UCI Adult census records.',
      '20% MCAR missingness and mean/mode plus kNN1/5/10 replace original 1%/10% trials and mixed Gaussian/discrete mixture comparisons.',
      'Mixed loss is explicitly 0.5×(continuous MSE+categorical 0/1 error); scales use only observed cells. No original imputationLossMixed parity or timing claim.'], runMixedImputation),
  define('linregSparseEmSynthDemo', 'Sparse Bayesian EM and nonconvex SCAD',
    'Student-t Gaussian-Gamma precision EM, genuine SCAD LLA, Lasso and Ridge',
    'Compare fitted coefficient bias, practical support and independent test prediction for four actual algorithms.',
    ['Synthetic correlated regression preserves the original type of experiment but bounds it to 24 features,90 train,200 test and one trial.',
      'Student-t precision-mixture EM substitutes for original NJ/NG/NEG priors; fixed known noise and penalties replace grid cross-validation.',
      'SCAD uses the actual Fan–Li piecewise penalty and coefficient-dependent derivative; it does not repeat the original helper’s constant-Lasso update.',
      'No original paper boxplots, tuning-optimality, exact-zero Student-t sparsity, or benchmark parity claim.'], runSparseRegression),
  define('multitaskRegDemo', 'When task pooling helps or hurts',
    'Separate stabilized least squares versus empirical common-mean Gaussian MAP slopes',
    'Vary sample size in related and heterogeneous task populations while keeping task intercepts separate.',
    ['Seeded synthetic 1D linear tasks follow the original educational setup; 10 tasks and N=4,8,16,32 replace the D=1/50,T=5/25 sweeps.',
      'Known fixed noise/prior precision substitutes for per-task residual-variance estimation; no mixture clustering of tasks.',
      'One seeded run compares related and heterogeneous slopes; reported MSE is against noiseless functions, not fabricated multi-seed confidence intervals.'], runMultitask),
  define('pcaYeast', 'Principal temporal bases of synthetic expression',
    'Centered population-covariance PCA by symmetric eigendecomposition',
    'Show variance spectrum, temporal bases, score embedding and rank-truncated reconstruction.',
    [syntheticNote, '90 generated profiles at 12 times replace filtered yeastData310 measurements.',
      'Three displayed bases and a fixed selected profile replace seven bases and interactive nearest-point picking. PCA mathematics and population covariance convention are retained.'], runPcaProfiles),
  define('gpSpatialDemoLaplace', 'Spatial count risk with a genuine Laplace GP',
    'Poisson log-Gaussian process, damped Newton posterior mode and inverse-Hessian Laplace covariance',
    'Infer a smooth relative-risk map and exposure-dependent uncertainty from synthetic Poisson counts.',
    [syntheticNote, 'A 6×6 artificial geography replaces the Finland heart-attack spatial benchmark.',
      'Dense Matérn-3/2 covariance with fixed hyperparameters replaces sparse FIC, inducing-grid design and covariance hyperparameter MAP optimization.',
      'Risk means and variances are lognormal moments under the actual mode/curvature Gaussian approximation; no MCMC/integrated-Laplace or exact-posterior claims.'], runSpatialGP),
  define('discreteDensityModelsShootout', 'Learning dependence in synthetic binary documents',
    'Independent Bernoulli and exact-EM latent-class categorical mixtures K=2,3',
    'Compare learned conditional structure, disjoint-test joint density, masked-cell cross entropy and Brier loss.',
    [syntheticNote, 'Synthetic 240 train/120 test binary rows with 12 variables replace 20 Newsgroups documents and 100 word indicators.',
      'Independence and two small mixture models replace the original large K mixture and binary/categorical-FA suites. No score for unimplemented FA models.',
      'Only implemented learned conditional tables are visualized; no tree/DAG/MRF structures are claimed. Missing-cell scores use a missing-cell denominator.'], seed => categoricalExperiment(seed, 2)),
];
