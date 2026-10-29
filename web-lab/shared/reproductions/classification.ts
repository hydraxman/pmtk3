/**
 * Independent bounded educational experiments. No original-engine results,
 * downloaded datasets, native classifiers, installers, or external services.
 */
import { linearFit } from '../numerics.js';
import {
  dot, mean, normal, seededRandom, sum, range, zeros, sigmoid, softThreshold,
  solve, line, scatter, matrixPlot,
} from './math.js';
import type { Reproduction, ExperimentResult, VisualPlot, VisualTrace } from './types.js';

type Matrix = number[][];
type Data = { X: Matrix; y: number[] };
type Predictor = { predict: (x: number[]) => number; scores: (x: number[]) => number[] };
const argmax = (x: number[]) => x.indexOf(Math.max(...x));
const softmax = (x: number[]) => {
  const m = Math.max(...x), e = x.map(v => Math.exp(v - m)), z = sum(e);
  return e.map(v => v / z);
};
const softplus = (x: number) => Math.max(0, x) + Math.log1p(Math.exp(-Math.abs(x)));
const sqdist = (a: number[], b: number[]) => sum(a.map((v, j) => (v - b[j]) ** 2));
const error = (m: Predictor, d: Data) => mean(d.X.map((x, i) => Number(m.predict(x) !== d.y[i])));
const accuracy = (m: Predictor, d: Data) => 1 - error(m, d);
const subset = (d: Data, ids: number[]): Data => ({ X: ids.map(i => d.X[i]), y: ids.map(i => d.y[i]) });
const bars = (name: string, x: string[], y: number[]): VisualTrace => ({ name, type: 'bar', x, y });
const probabilityCheck = (rows: Matrix) => rows.every(row =>
  row.every(p => p >= 0 && p <= 1) && Math.abs(sum(row) - 1) < 1e-10);
const check = (name: string, passed: boolean, detail?: string) => ({ name, passed, detail });

function shuffled(n: number, rng: () => number) {
  const ids = range(n);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** Balanced, generated data, never the Fisher iris / medical / benchmark data. */
function generated(seed: number, kind: 'rings' | 'blobs' | 'sparse', n = 108): Data {
  const rng = seededRandom(seed), classes = kind === 'blobs' ? 3 : 2;
  const y = range(n).map(i => i % classes);
  const X = y.map(c => {
    if (kind === 'rings') {
      const theta = 2 * Math.PI * rng(), radius = (c ? 1.65 : .62) + .17 * normal(rng);
      return [radius * Math.cos(theta), radius * Math.sin(theta)];
    }
    if (kind === 'sparse') return range(12).map(j =>
      (j < 2 ? (2 * c - 1) * (j ? -.85 : 1.1) : 0) + normal(rng));
    const theta = c * 2 * Math.PI / 3, a = normal(rng), b = normal(rng);
    return [1.65 * Math.cos(theta) + (.36 + .14 * c) * a,
      1.65 * Math.sin(theta) + .2 * a + (.3 + .08 * c) * b];
  });
  return subset({ X, y }, shuffled(n, rng));
}

function split(d: Data, fraction = .7) {
  const train: number[] = [], test: number[] = [];
  for (const c of [...new Set(d.y)]) {
    const ids = range(d.y.length).filter(i => d.y[i] === c), n = Math.floor(ids.length * fraction);
    train.push(...ids.slice(0, n)); test.push(...ids.slice(n));
  }
  return { train: subset(d, train), test: subset(d, test) };
}
function folds(d: Data, k = 3) {
  const ids = range(k).map(() => [] as number[]);
  for (const c of [...new Set(d.y)]) {
    range(d.y.length).filter(i => d.y[i] === c).forEach((i, j) => ids[j % k].push(i));
  }
  return ids.map(valid => ({
    train: subset(d, range(d.y.length).filter(i => !valid.includes(i))), valid: subset(d, valid),
  }));
}
function standardizer(X: Matrix) {
  const mu = X[0].map((_, j) => mean(X.map(row => row[j])));
  const sd = mu.map((m, j) => Math.sqrt(mean(X.map(row => (row[j] - m) ** 2))) || 1);
  return (x: number[]) => x.map((v, j) => (v - mu[j]) / sd[j]);
}
type KernelName = 'linear' | 'rbf' | 'poly3';
function kernel(a: number[], b: number[], kind: KernelName, gamma = 1) {
  return kind === 'linear' ? dot(a, b) : kind === 'rbf' ? Math.exp(-gamma * sqdist(a, b))
    : (1 + dot(a, b) / a.length) ** 3;
}

/** Multinomial logistic regression; proximal GD, unpenalized intercept. */
export function fitSoftmax(X: Matrix, y: number[], lambda = .02, l1 = false, iterations = 160) {
  const k = Math.max(...y) + 1, p = X[0].length + 1, design = X.map(x => [1, ...x]);
  const W = zeros(k, p), history: number[] = [];
  // The softmax covariance spectral norm is <= 1/2.
  const step = 1 / (.5 * Math.max(...design.map(x => dot(x, x))) + (l1 ? 0 : lambda) + 1e-9);
  const scores = (x: number[]) => W.map(w => dot(w, [1, ...x]));
  const objective = () => mean(design.map((x, i) => {
    const s = W.map(w => dot(w, x)), m = Math.max(...s);
    return m + Math.log(sum(s.map(v => Math.exp(v - m)))) - s[y[i]];
  })) + lambda * sum(W.flatMap(w => w.slice(1).map(v => l1 ? Math.abs(v) : .5 * v * v)));
  history.push(objective());
  for (let t = 0; t < iterations; t++) {
    const grad = zeros(k, p);
    design.forEach((x, i) => {
      const pr = softmax(W.map(w => dot(w, x)));
      for (let c = 0; c < k; c++) for (let j = 0; j < p; j++)
        grad[c][j] += (pr[c] - Number(y[i] === c)) * x[j] / X.length;
    });
    for (let c = 0; c < k; c++) for (let j = 0; j < p; j++) {
      const next = W[c][j] - step * (grad[c][j] + (!l1 && j ? lambda * W[c][j] : 0));
      W[c][j] = l1 && j ? softThreshold(next, step * lambda) : next;
    }
    if (t % 10 === 9 || t === iterations - 1) history.push(objective());
  }
  return { W, history, scores, probabilities: (x: number[]) => softmax(scores(x)),
    predict: (x: number[]) => argmax(scores(x)) };
}

/**
 * Soft-margin binary SVM dual, deterministic two-coordinate SMO.
 * The dual equality sum(alpha_i*y_i)=0 is preserved by every update.
 */
export function fitBinarySvm(X: Matrix, y: number[], C = 2, kind: KernelName = 'linear', gamma = 1) {
  const n = X.length, K = X.map(a => X.map(b => kernel(a, b, kind, gamma)));
  const alpha = Array<number>(n).fill(0), f = Array<number>(n).fill(0);
  let bias = 0, idle = 0, sweeps = 0;
  for (; sweeps < 90 && idle < 6; sweeps++) {
    let changes = 0;
    for (let i = 0; i < n; i++) {
      const Ei = f[i] - y[i], ri = y[i] * Ei;
      if (!((ri < -1e-5 && alpha[i] < C - 1e-9) || (ri > 1e-5 && alpha[i] > 1e-9))) continue;
      const order = range(n).filter(j => j !== i).sort((a, b) =>
        Math.abs(Ei - (f[b] - y[b])) - Math.abs(Ei - (f[a] - y[a])));
      for (const j of order) {
        const ai = alpha[i], aj = alpha[j], Ej = f[j] - y[j], same = y[i] === y[j];
        const lo = same ? Math.max(0, ai + aj - C) : Math.max(0, aj - ai);
        const hi = same ? Math.min(C, ai + aj) : Math.min(C, C + aj - ai);
        const eta = K[i][i] + K[j][j] - 2 * K[i][j];
        if (hi - lo < 1e-12 || eta < 1e-12) continue;
        const nextj = Math.max(lo, Math.min(hi, aj + y[j] * (Ei - Ej) / eta));
        if (Math.abs(nextj - aj) < 1e-8) continue;
        const nexti = ai + y[i] * y[j] * (aj - nextj);
        const di = (nexti - ai) * y[i], dj = (nextj - aj) * y[j];
        const b1 = bias - Ei - di * K[i][i] - dj * K[i][j];
        const b2 = bias - Ej - di * K[i][j] - dj * K[j][j];
        const nextb = nexti > 1e-9 && nexti < C - 1e-9 ? b1
          : nextj > 1e-9 && nextj < C - 1e-9 ? b2 : (b1 + b2) / 2;
        for (let r = 0; r < n; r++) f[r] += di * K[r][i] + dj * K[r][j] + nextb - bias;
        alpha[i] = nexti; alpha[j] = nextj; bias = nextb;
        changes++; break;
      }
    }
    idle = changes ? 0 : idle + 1;
  }
  const score = (x: number[]) => bias + sum(X.map((v, i) => alpha[i] * y[i] * kernel(v, x, kind, gamma)));
  const margins = f.map((v, i) => y[i] * v);
  const kktViolation = Math.max(...margins.map((m, i) => Math.max(0,
    alpha[i] < C - 1e-6 ? 1 - m : 0, alpha[i] > 1e-6 ? m - 1 : 0)));
  const normSquared = sum(alpha.map((a, i) => a * y[i] * (f[i] - bias)));
  return { alpha, bias, C, score, margins, sweeps, kktViolation,
    equalityResidual: Math.abs(dot(alpha, y)),
    dualObjective: sum(alpha) - .5 * normSquared,
    primalObjective: .5 * normSquared + C * sum(margins.map(m => Math.max(0, 1 - m))),
    supportCount: alpha.filter(a => a > 1e-7).length };
}

type Algorithm = 'L1 softmax' | 'L2 softmax' | 'kernel ridge' | 'Gaussian NB' | 'SVM';
type Setting = { algorithm: Algorithm; lambda: number; gamma?: number; feature?: 'linear' | 'rbf' | 'poly3' };
export function fitGaussianNb(X: Matrix, y: number[], varianceSmoothing = .03) {
  const k = Math.max(...y) + 1, groups = range(k).map(c => X.filter((_, i) => y[i] === c));
  const means = groups.map(g => X[0].map((_, j) => mean(g.map(row => row[j]))));
  const variance = groups.map((g, c) => means[c].map((v, j) =>
    mean(g.map(row => (row[j] - v) ** 2)) + varianceSmoothing));
  const priors = groups.map(g => g.length / X.length);
  const scores = (x: number[]) => means.map((m, c) => Math.log(priors[c]) -
    .5 * sum(m.map((v, j) => Math.log(2 * Math.PI * variance[c][j]) + (x[j] - v) ** 2 / variance[c][j])));
  return { means, variance, priors, scores, probabilities: (x: number[]) => softmax(scores(x)),
    predict: (x: number[]) => argmax(scores(x)) };
}
/** One-hot-target kernel ridge, with no intercept: (K + lambda I) alpha_c = 1[y=c]. */
export function fitKernelRidge(X: Matrix, y: number[], lambda = .3, kind: KernelName = 'rbf', gamma = 1) {
  const k = Math.max(...y) + 1, K = X.map(a => X.map(b => kernel(a, b, kind, gamma)));
  const A = K.map((row, i) => row.map((v, j) => v + Number(i === j) * lambda));
  const coefficients = range(k).map(c => solve(A, y.map(v => Number(v === c))));
  const scores = (x: number[]) => {
    const v = X.map(row => kernel(row, x, kind, gamma));
    return coefficients.map(w => dot(w, v));
  };
  const normalResidual = Math.max(...coefficients.flatMap((w, c) =>
    A.map((row, i) => Math.abs(dot(row, w) - Number(y[i] === c)))));
  return { coefficients, scores, predict: (x: number[]) => argmax(scores(x)), normalResidual };
}
function fitClassifier(d: Data, setting: Setting): Predictor & { active: number; residual: number } {
  const transform = standardizer(d.X), X = d.X.map(transform), k = Math.max(...d.y) + 1;
  const kind = setting.feature ?? 'linear', gamma = setting.gamma ?? 1;
  if (setting.algorithm === 'Gaussian NB') {
    const model = fitGaussianNb(X, d.y, setting.lambda), scores = (x: number[]) => model.scores(transform(x));
    const valid = model.variance.every(row => row.every(v => Number.isFinite(v) && v > 0)) &&
      Math.abs(sum(model.priors) - 1) < 1e-10;
    return { scores, predict: x => argmax(scores(x)), active: k * (2 * X[0].length + 1), residual: valid ? 0 : Infinity };
  }
  if (setting.algorithm === 'SVM') {
    const models = range(k).map(c =>
      fitBinarySvm(X, d.y.map(v => v === c ? 1 : -1), 1 / setting.lambda, kind, gamma));
    const scores = (x: number[]) => models.map(m => m.score(transform(x)));
    return { scores, predict: x => argmax(scores(x)), active: sum(models.map(m => m.supportCount)),
      residual: Math.max(...models.map(m => m.equalityResidual)) };
  }
  if (setting.algorithm === 'kernel ridge') {
    const model = fitKernelRidge(X, d.y, setting.lambda, kind, gamma), scores = (x: number[]) => model.scores(transform(x));
    return { scores, predict: x => argmax(scores(x)), active: k * X.length, residual: model.normalResidual };
  }
  const features = (z: number[]) => kind === 'linear' ? z : X.map(row => kernel(row, z, kind, gamma));
  const model = fitSoftmax(X.map(features), d.y, setting.lambda, setting.algorithm === 'L1 softmax');
  const scores = (x: number[]) => model.scores(features(transform(x)));
  return { scores, predict: x => argmax(scores(x)),
    active: model.W.flatMap(w => w.slice(1)).filter(v => Math.abs(v) > 1e-7).length,
    residual: Math.max(0, ...model.history.slice(1).map((v, i) => v - model.history[i])) };
}
function select(d: Data, candidates: Setting[]) {
  const partition = folds(d);
  const losses = candidates.map(s => mean(partition.map(f => error(fitClassifier(f.train, s), f.valid))));
  const chosen = losses.indexOf(Math.min(...losses));
  return { setting: candidates[chosen], losses, chosen, model: fitClassifier(d, candidates[chosen]) };
}
function region(title: string, d: Data, model: Predictor): VisualPlot {
  const lo = [0, 1].map(j => Math.min(...d.X.map(x => x[j])) - .3);
  const hi = [0, 1].map(j => Math.max(...d.X.map(x => x[j])) + .3);
  const grid = range(25).flatMap(i => range(25).map(j => [
    lo[0] + (hi[0] - lo[0]) * i / 24, lo[1] + (hi[1] - lo[1]) * j / 24,
  ]));
  return { title, xLabel: 'Synthetic feature 1', yLabel: 'Synthetic feature 2', traces: [
    { ...scatter('Predicted class grid', grid.map(x => x[0]), grid.map(x => x[1])),
      marker: { color: grid.map(x => model.predict(x)), size: 5, colorscale: 'Viridis', symbol: 'square' } },
    ...[...new Set(d.y)].sort().map(c => {
      const X = d.X.filter((_, i) => d.y[i] === c);
      return { ...scatter(`Observed class ${c}`, X.map(x => x[0]), X.map(x => x[1])),
        marker: { size: 7, symbol: c === 0 ? 'circle' : c === 1 ? 'x' : 'diamond' } };
    }),
  ] };
}

function shootout(seed: number, fixed: boolean): ExperimentResult {
  const kinds = fixed ? ['rings', 'sparse'] as const : ['rings', 'blobs'] as const;
  const plots: VisualPlot[] = [], metrics: Record<string, number | string> = {}, checks = [];
  for (let di = 0; di < kinds.length; di++) {
    const kind = kinds[di], d = split(generated(seed + di * 7919, kind, 90));
    const scale = standardizer(d.train.X), z = d.train.X.map(scale);
    const distances = z.flatMap((a, i) => z.slice(i + 1).map(b => sqdist(a, b))).sort((a, b) => a - b);
    const gamma = 1 / Math.max(1e-6, distances[Math.floor(distances.length / 2)]);
    const methods: Algorithm[] = fixed ? ['L1 softmax', 'L2 softmax', 'kernel ridge']
      : ['L2 softmax', 'Gaussian NB', 'kernel ridge', 'SVM'];
    const labels: string[] = [], testErrors: number[] = [], cvErrors: number[] = [], complexity: number[] = [];
    for (const algorithm of methods) {
      const feature = fixed && kind === 'sparse' || !fixed && ['L2 softmax', 'Gaussian NB'].includes(algorithm)
        ? 'linear' : 'rbf';
      const gammas = feature === 'rbf' ? fixed ? [gamma] : [.25, 1.5] : [1];
      const candidates = gammas.flatMap(g => [.03, .3].map(lambda => ({ algorithm, lambda, gamma: g, feature }) as Setting));
      const selected = select(d.train, candidates);
      const label = `${feature} ${algorithm}`;
      labels.push(label); testErrors.push(error(selected.model, d.test));
      cvErrors.push(selected.losses[selected.chosen]); complexity.push(selected.model.active);
      metrics[`${kind}: ${label} test accuracy`] = 1 - testErrors.at(-1)!;
      metrics[`${kind}: ${label} selected lambda`] = selected.setting.lambda;
      if (feature === 'rbf') metrics[`${kind}: ${label} selected gamma`] = selected.setting.gamma!;
      checks.push(check(`${kind}: ${label} solver invariant`, selected.model.residual < 1e-8,
        algorithm === 'SVM' ? 'Dual equality residual' : algorithm === 'kernel ridge'
          ? 'Kernel ridge normal-equation residual' : 'Proximal objective nonincrease / positive variances'));
    }
    plots.push({ title: `${kind}: genuine held-out errors (${d.train.y.length} train / ${d.test.y.length} test)`,
      yLabel: 'Misclassification fraction', traces: [bars('3-fold CV (training only)', labels, cvErrors),
        bars('Untouched test', labels, testErrors)] });
    plots.push({ title: `${kind}: fitted complexity (not comparable parameter units)`, yLabel: 'Count',
      traces: [bars('Active weights / kernel coefficients / support vectors / NB parameters', labels, complexity)] });
    metrics[`${kind}: training cases`] = d.train.y.length;
    metrics[`${kind}: held-out cases`] = d.test.y.length;
    checks.push(check(`${kind}: disjoint evaluation`, d.train.X.every(x => !d.test.X.includes(x))));
  }
  metrics.selection = fixed ? 'Training-only median-distance gamma; 3-fold lambda CV'
    : '3-fold joint gamma/lambda CV for nonlinear models; lambda CV for linear/NB';
  return { plots, metrics, checks, notes: ['All data are seeded synthetic; no published benchmark scores.',
    'SVM / ridge kernel coefficients and primal logistic coefficients have different meanings; counts are labeled, not equated.'] };
}

function linearComparison(seed: number): ExperimentResult {
  const settings: Setting[] = [
    { algorithm: 'SVM', lambda: .2, feature: 'linear' },
    { algorithm: 'kernel ridge', lambda: .3, feature: 'linear' },
    { algorithm: 'L1 softmax', lambda: .04, feature: 'linear' },
    { algorithm: 'L2 softmax', lambda: .04, feature: 'linear' },
  ];
  const names = settings.map(s => `Linear ${s.algorithm}`), plots: VisualPlot[] = [], checks = [];
  const metrics: Record<string, number | string> = { repeats: 3, regularization: 'Fixed, explicitly shown; no ARD or native RVM' };
  for (const kind of ['blobs', 'sparse'] as const) {
    const errors: Matrix = [], active: Matrix = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const d = split(generated(seed + repeat * 1013, kind, 96));
      const models = settings.map(s => fitClassifier(d.train, s));
      errors.push(models.map(m => error(m, d.test))); active.push(models.map(m => m.active));
      checks.push(check(`${kind} repeat ${repeat}: solver invariants`, models.every(m => m.residual < 1e-8)));
    }
    plots.push({ title: `${kind}: independent synthetic trials`, yLabel: 'Held-out error',
      traces: errors.map((row, i) => bars(`Split ${i + 1}`, names, row)) });
    plots.push({ title: `${kind}: average active model counts`, yLabel: 'Count (algorithm-specific)',
      traces: [bars('Mean count over 3 trials', names, names.map((_, j) => mean(active.map(row => row[j]))))] });
    names.forEach((name, j) => { metrics[`${kind}: ${name} mean accuracy`] = 1 - mean(errors.map(row => row[j])); });
  }
  return { plots, metrics, checks, notes: ['Generated 3-class blobs and 12-dimensional sparse-signal data, not soy/fglass/colon/AML.',
    'L1/L2 lambda=.04; SVM C=5; linear kernel ridge lambda=.3. Counts are not RVM relevance counts.'] };
}

export type CartNode = {
  prediction: number; impurity: number; count: number; feature?: number; threshold?: number;
  left?: CartNode; right?: CartNode; gain?: number;
};
const gini = (y: number[]) => 1 - sum([...new Set(y)].map(c => (y.filter(v => v === c).length / y.length) ** 2));
export function fitCart(X: Matrix, y: number[], depth = 4, minimumLeaf = 3): CartNode {
  const classes = [...new Set(y)].sort((a, b) => a - b);
  const prediction = classes[argmax(classes.map(c => y.filter(v => v === c).length))];
  const node: CartNode = { prediction, impurity: gini(y), count: y.length };
  if (!depth || !node.impurity || y.length < minimumLeaf * 2) return node;
  let best = node.impurity, chosen: { j: number; threshold: number; left: number[]; right: number[] } | undefined;
  for (let j = 0; j < X[0].length; j++) {
    const values = [...new Set(X.map(x => x[j]))].sort((a, b) => a - b);
    for (let t = 1; t < values.length; t++) {
      const threshold = (values[t - 1] + values[t]) / 2;
      const left = range(y.length).filter(i => X[i][j] <= threshold);
      const right = range(y.length).filter(i => X[i][j] > threshold);
      if (Math.min(left.length, right.length) < minimumLeaf) continue;
      const cost = (left.length * gini(left.map(i => y[i])) + right.length * gini(right.map(i => y[i]))) / y.length;
      if (cost < best - 1e-12) { best = cost; chosen = { j, threshold, left, right }; }
    }
  }
  if (chosen) {
    node.feature = chosen.j; node.threshold = chosen.threshold; node.gain = node.impurity - best;
    node.left = fitCart(chosen.left.map(i => X[i]), chosen.left.map(i => y[i]), depth - 1, minimumLeaf);
    node.right = fitCart(chosen.right.map(i => X[i]), chosen.right.map(i => y[i]), depth - 1, minimumLeaf);
  }
  return node;
}
export function predictCart(node: CartNode, x: number[]): number {
  return node.left && node.right ? predictCart(x[node.feature!] <= node.threshold! ? node.left : node.right, x) : node.prediction;
}
const cartPredictor = (node: CartNode): Predictor => ({ predict: x => predictCart(node, x),
  scores: x => [predictCart(node, x)] });
function cartNodes(node: CartNode): CartNode[] {
  return [node, ...(node.left ? cartNodes(node.left) : []), ...(node.right ? cartNodes(node.right) : [])];
}
function treeDemo(seed: number): ExperimentResult {
  const data = generated(seed, 'blobs', 150);
  // Deliberate overlap creates a useful model-selection problem.
  const rng = seededRandom(seed ^ 721);
  data.X = data.X.map(x => x.map(v => v + .55 * normal(rng)));
  const d = split(data), partition = folds(d.train), depths = range(6).map(i => i + 1);
  const cv = depths.map(depth => partition.map(f => error(cartPredictor(fitCart(f.train.X, f.train.y, depth)), f.valid)));
  const costs = cv.map(mean), best = argmax(costs.map(v => -v));
  const se = Math.sqrt(sum(cv[best].map(v => (v - costs[best]) ** 2)) / (cv[best].length - 1) / cv[best].length);
  const selected = depths[costs.findIndex(v => v <= costs[best] + se + 1e-12)];
  const model = fitCart(d.train.X, d.train.y, selected), unpruned = fitCart(d.train.X, d.train.y, 6);
  const nodes = cartNodes(model);
  return {
    plots: [
      { title: 'CART depth selection: one-standard-error rule', xLabel: 'Maximum depth', yLabel: 'Error fraction',
        traces: [line('3-fold validation error', depths, costs),
          line('Resubstitution error', depths, depths.map(depth => error(cartPredictor(fitCart(d.train.X, d.train.y, depth)), d.train))),
          line('Minimum CV + one SE', depths, depths.map(() => costs[best] + se))] },
      region(`Selected depth ${selected}: held-out synthetic observations`, d.test, cartPredictor(model)),
      region('Depth 6: comparison, same training set', d.test, cartPredictor(unpruned)),
    ],
    metrics: { selectedDepth: selected, testAccuracy: accuracy(cartPredictor(model), d.test),
      trainingAccuracy: accuracy(cartPredictor(model), d.train), cvError: costs[selected - 1],
      terminalNodes: nodes.filter(n => !n.left).length, trainingCases: d.train.y.length, testCases: d.test.y.length },
    checks: [
      check('CART weighted Gini impurity decreases at each split', nodes.filter(n => n.left).every(n => n.gain! > 0)),
      check('CART child sample conservation', nodes.filter(n => n.left).every(n => n.left!.count + n.right!.count === n.count)),
      check('One-SE selects shallowest eligible depth', selected === depths.find(v => costs[v - 1] <= costs[best] + se + 1e-12)),
    ], notes: ['Synthetic overlapping Gaussian classes, NOT iris measurements. Depth-limited refitting replaces cost-complexity pruning.',
      'Three stratified folds replace the original ten; test data are not used in depth selection.'],
  };
}

/** Full 2-D Gaussian discriminants, sample covariance and explicit diagonal shrinkage. */
export function fitDiscriminant(X: Matrix, y: number[], quadratic = false, shrinkage = .03) {
  const k = Math.max(...y) + 1, groups = range(k).map(c => X.filter((_, i) => y[i] === c));
  const means = groups.map(g => [0, 1].map(j => mean(g.map(x => x[j]))));
  const sample = groups.map((g, c) => [0, 1].map(j => [0, 1].map(l =>
    sum(g.map(x => (x[j] - means[c][j]) * (x[l] - means[c][l]))) / (g.length - 1))));
  const pooled = [0, 1].map(j => [0, 1].map(l =>
    sum(sample.map((s, c) => s[j][l] * (groups[c].length - 1))) / (X.length - k)));
  const covariance = sample.map(s => (quadratic ? s : pooled).map((row, j) =>
    row.map((v, l) => v + Number(j === l) * shrinkage)));
  const determinants = covariance.map(s => s[0][0] * s[1][1] - s[0][1] ** 2);
  const scores = (x: number[]) => means.map((m, c) => {
    const a = x[0] - m[0], b = x[1] - m[1], s = covariance[c], det = determinants[c];
    return Math.log(groups[c].length / X.length) - .5 * Math.log(det)
      - .5 * (s[1][1] * a * a - 2 * s[0][1] * a * b + s[0][0] * b * b) / det;
  });
  return { means, covariance, determinants, scores, probabilities: (x: number[]) => softmax(scores(x)),
    predict: (x: number[]) => argmax(scores(x)) };
}
function discriminantDemo(seed: number): ExperimentResult {
  const d = split(generated(seed, 'blobs', 150)), models = [false, true].map(q => fitDiscriminant(d.train.X, d.train.y, q));
  const names = ['LDA pooled full covariance', 'QDA class-specific full covariance'];
  const confusion = (m: Predictor) => range(3).map(c => range(3).map(p =>
    d.test.y.filter((v, i) => v === c && m.predict(d.test.X[i]) === p).length));
  const cv = [false, true].map(q => mean(folds(d.train).map(f => error(fitDiscriminant(f.train.X, f.train.y, q), f.valid))));
  const diff = (x: number[]) => models[0].scores(x)[0] - models[0].scores(x)[1];
  const residual = Math.abs(diff([-1, .2]) - 2 * diff([0, .2]) + diff([1, .2]));
  return { plots: [
    ...models.map((m, i) => region(names[i], d.test, m)),
    { title: 'Discriminant evaluation', yLabel: 'Error fraction', traces: [
      bars('3-fold CV', names, cv), bars('Untouched test', names, models.map(m => error(m, d.test)))] },
    ...models.map((m, i) => matrixPlot(`${names[i]} confusion (rows true / columns predicted)`, confusion(m))),
  ], metrics: { ldaTestAccuracy: accuracy(models[0], d.test), qdaTestAccuracy: accuracy(models[1], d.test),
    ldaCvError: cv[0], qdaCvError: cv[1], ldaAffineScoreResidual: residual, covarianceShrinkage: .03 },
  checks: [
    check('Gaussian covariance matrices are positive definite', models.every(m => m.determinants.every(v => v > 0))),
    check('Discriminant class posteriors normalize', models.every(m => probabilityCheck(d.test.X.map(m.probabilities)))),
    check('LDA log-odds are affine (zero second difference)', residual < 1e-9),
    check('Confusion counts conserve test sample count', models.every(m => sum(confusion(m).flat()) === d.test.y.length)),
  ], notes: ['Synthetic 2-D Gaussian classes, NOT Fisher iris. Explicit .03 diagonal shrinkage keeps covariances nonsingular.',
    'Three stratified folds and a held-out split replace original ten-fold/resubstitution-only figures.'] };
}

function kernelComparison(seed: number): ExperimentResult {
  const d = split(generated(seed, 'rings', 120));
  const settings: Setting[] = [
    { algorithm: 'L1 softmax', lambda: .01, gamma: 1.2, feature: 'rbf' },
    { algorithm: 'L2 softmax', lambda: .03, gamma: 1.2, feature: 'rbf' },
    { algorithm: 'SVM', lambda: .2, gamma: 1.2, feature: 'rbf' },
  ];
  const models = settings.map(s => fitClassifier(d.train, s)), names = ['L1 RBF-basis softmax', 'L2 RBF-basis softmax', 'RBF SVM (SMO)'];
  return { plots: [...models.map((m, i) => region(names[i], d.test, m)),
    { title: 'Held-out classification and training-only complexity', yLabel: 'Test error',
      traces: [bars('Held-out error', names, models.map(m => error(m, d.test)))] },
    { title: 'Active logistic coefficients / SVM support vectors', yLabel: 'Algorithm-specific count',
      traces: [bars('Measured fitted count', names, models.map(m => m.active))] },
  ], metrics: Object.fromEntries(models.flatMap((m, i) =>
    [[`${names[i]} accuracy`, accuracy(m, d.test)], [`${names[i]} active count`, m.active]])),
  checks: [check('Proximal objective descent and SVM dual equality', models.every(m => m.residual < 1e-8)),
    check('All three learners beat constant-class test prediction', models.every(m => accuracy(m, d.test) > .5))],
  notes: ['Synthetic noisy rings replace bishop2class. RVM is omitted, never impersonated by another sparse method.',
    'RBF is exp(-gamma*distance²), gamma=1.2 on training-standardized data, without original kernelRbfSigma amplitude.',
    'Logistic lambda=.01 (L1) / .03 (L2); SVM C=5. Hyperparameters are fixed for this visual comparison.'] };
}

/**
 * Epsilon-SVR dual with regularized intercept: kernel is 1 + x·z.
 * Coordinate descent minimizes .5 beta'K beta + eps|beta| - y'beta,
 * subject to |beta_i|<=C. This is not the unregularized-intercept LIBSVM dual.
 */
export function fitEpsilonSvr(X: Matrix, y: number[], C = 2, epsilon = .1, sweeps = 160) {
  const K = X.map(a => X.map(b => 1 + dot(a, b))), beta = X.map(() => 0), fitted = X.map(() => 0);
  for (let t = 0; t < sweeps; t++) for (let i = 0; i < X.length; i++) {
    const next = Math.max(-C, Math.min(C, softThreshold(beta[i] + (y[i] - fitted[i]) / K[i][i], epsilon / K[i][i])));
    const delta = next - beta[i]; beta[i] = next;
    for (let j = 0; j < X.length; j++) fitted[j] += K[j][i] * delta;
  }
  const prediction = (x: number[]) => sum(beta.map((b, i) => b * (1 + dot(x, X[i]))));
  const coordinateResidual = Math.max(...beta.map((b, i) => Math.abs(b -
    Math.max(-C, Math.min(C, softThreshold(b + (y[i] - fitted[i]) / K[i][i], epsilon / K[i][i]))))));
  return { beta, fitted, prediction, coordinateResidual };
}
function svmDemo(seed: number): ExperimentResult {
  const d = split(generated(seed, 'rings', 90)), kinds = ['linear', 'poly3', 'rbf'] as const;
  const selected = kinds.map(feature => select(d.train, [.2, 1, 5].map(C =>
    ({ algorithm: 'SVM', lambda: 1 / C, feature, gamma: 1 }))));
  const rng = seededRandom(seed + 83), x = range(64).map(i => -2 + 4 * i / 63);
  const target = x.map(v => .7 + 1.2 * v + .16 * normal(rng));
  const svr = fitEpsilonSvr(x.slice(0, 48).map(v => [v]), target.slice(0, 48), 3, .15, 500);
  const grid = range(80).map(i => -2 + 4 * i / 79);
  const multi = split(generated(seed + 31, 'blobs', 108));
  const ovr = fitClassifier(multi.train, { algorithm: 'SVM', lambda: .2, feature: 'linear' });
  const singleScale = standardizer(d.train.X), zx = d.train.X.map(singleScale);
  const binary = fitBinarySvm(zx, d.train.y.map(v => v ? 1 : -1), 5, 'rbf', 1);
  const mse = mean(x.slice(48).map((v, i) => (svr.prediction([v]) - target[i + 48]) ** 2));
  return { plots: [
    { title: 'One real solver, three kernels; C selected using training folds', yLabel: 'Error fraction',
      traces: [bars('3-fold CV', [...kinds], selected.map(s => s.losses[s.chosen])),
        bars('Held-out error', [...kinds], selected.map(s => error(s.model, d.test)))] },
    region('Selected RBF SVM on held-out rings', d.test, selected[2].model),
    { title: 'Epsilon-SVR: held-out extrapolation', xLabel: 'Synthetic covariate', yLabel: 'Response',
      traces: [scatter('Training', x.slice(0, 48), target.slice(0, 48)), scatter('Held-out', x.slice(48), target.slice(48)),
        line('SVR prediction', grid, grid.map(v => svr.prediction([v]))), line('Generating mean', grid, grid.map(v => .7 + 1.2 * v))] },
    region('Three-class one-vs-rest linear SVM', multi.test, ovr),
  ], metrics: {
    ...Object.fromEntries(selected.flatMap((s, i) => [[`${kinds[i]} test accuracy`, accuracy(s.model, d.test)],
      [`${kinds[i]} selected C`, 1 / s.setting.lambda]])),
    multiclassAccuracy: accuracy(ovr, multi.test), svrTestMse: mse, svrCoordinateResidual: svr.coordinateResidual,
    svmDualEqualityResidual: binary.equalityResidual, svmKktViolation: binary.kktViolation,
    svmDualityGap: binary.primalObjective - binary.dualObjective, supportVectors: binary.supportCount,
  }, checks: [
    check('SVM dual equality constraint', binary.equalityResidual < 1e-8),
    check('SVM box constraints', binary.alpha.every(a => a >= -1e-9 && a <= binary.C + 1e-9)),
    check('Weak duality', binary.primalObjective + 1e-8 >= binary.dualObjective),
    check('SVR dual box constraints', svr.beta.every(b => Math.abs(b) <= 3 + 1e-9)),
    check('SVR coordinate optimality', svr.coordinateResidual < .02),
  ], notes: ['Synthetic rings, Gaussian classes, and a linear regression response replace crabs/soy/prostate.',
    'Only this TypeScript SMO implementation is evaluated; no fabricated LIBSVM/SVMlight/QP backend comparisons.',
    'Regression is real epsilon-insensitive SVR with a regularized intercept (C=3, epsilon=.15), not original default RBF SVR.',
    'Bounded solver iterations; KKT violation and duality gap are reported, not an assertion of exact convergence.'] };
}
function oneVsRest(seed: number): ExperimentResult {
  const d = split(generated(seed, 'blobs', 144)), transform = standardizer(d.train.X), X = d.train.X.map(transform);
  const models = range(3).map(c => fitBinarySvm(X, d.train.y.map(v => v === c ? 1 : -1), 3));
  const scores = (x: number[]) => models.map(m => m.score(transform(x)));
  const wrapped: Predictor = { scores, predict: x => argmax(scores(x)) };
  const direct = (x: number[]) => {
    let label = 0, best = -Infinity;
    models.forEach((m, c) => { const s = m.score(transform(x)); if (s > best) { best = s; label = c; } });
    return label;
  };
  const confusion = range(3).map(c => range(3).map(p => d.test.y.filter((v, i) => v === c && wrapped.predict(d.test.X[i]) === p).length));
  return { plots: [region('One-vs-rest argmax of three signed margins', d.test, wrapped),
    matrixPlot('Held-out confusion: true class rows, predicted class columns', confusion),
    { title: 'Per-class signed decision functions (not probabilities)', xLabel: 'Held-out observation index', yLabel: 'Signed margin',
      traces: models.map((m, c) => line(`Class ${c} vs rest`, range(d.test.X.length), d.test.X.map(x => m.score(transform(x))))) }],
  metrics: { testAccuracy: accuracy(wrapped, d.test), classifiers: 3, C: 3,
    supportVectorsSummed: sum(models.map(m => m.supportCount)), maximumKktViolation: Math.max(...models.map(m => m.kktViolation)) },
  checks: [check('Wrapper equals independent explicit maximum-score dispatch', d.test.X.every(x => wrapped.predict(x) === direct(x))),
    check('Every binary target contains both signs', range(3).every(c => d.train.y.includes(c) && d.train.y.some(y => y !== c))),
    check('Every binary dual preserves equality', models.every(m => m.equalityResidual < 1e-8)),
    check('Confusion sample conservation', sum(confusion.flat()) === d.test.y.length)],
  notes: ['Synthetic three-class data replace soy. The consistency check compares dispatch logic over the same learned models, NOT liblinear equivalence.',
    'Margins are not calibrated class probabilities; no external solver runs.'] };
}

/** Binary 6x6 vertical, horizontal, and diagonal glyphs; NOT MNIST. */
function glyphs(seed: number, perClass: number, shifted = false): Data {
  const rng = seededRandom(seed), X: Matrix = [], y: number[] = [];
  for (let c = 0; c < 3; c++) for (let i = 0; i < perClass; i++) {
    const offset = shifted ? Math.floor(rng() * 3) - 1 : 0;
    X.push(range(36).map(j => {
      const r = Math.floor(j / 6), col = j % 6;
      const on = c === 0 ? col === 2 + offset : c === 1 ? r === 2 + offset : col === r + offset;
      return Number(rng() < .025 ? !on : on);
    }));
    y.push(c);
  }
  return subset({ X, y }, shuffled(y.length, rng));
}
export type LabelRbm = { W: Matrix; hiddenBias: number[]; visibleBias: number[]; U: Matrix; labelBias: number[] };
export function rbmHiddenProbabilities(m: LabelRbm, v: number[], label?: number) {
  const activation = [...m.hiddenBias];
  for (let i = 0; i < v.length; i++) for (let j = 0; j < activation.length; j++)
    activation[j] += v[i] * m.W[i][j];
  return activation.map((a, j) => sigmoid(a + (label === undefined ? 0 : m.U[label][j])));
}
/** Exact sum over binary hidden units, represented by factorized softplus. */
export function rbmClassProbabilities(m: LabelRbm, v: number[]) {
  const activation = [...m.hiddenBias];
  for (let i = 0; i < v.length; i++) for (let j = 0; j < activation.length; j++)
    activation[j] += v[i] * m.W[i][j];
  return softmax(m.labelBias.map((b, c) => b + sum(activation.map((h, j) => softplus(h + m.U[c][j])))));
}
export function fitRbm(X: Matrix, hidden: number, seed: number, labels?: number[], epochs = 40) {
  const rng = seededRandom(seed), dim = X[0].length, classes = labels ? Math.max(...labels) + 1 : 0;
  const m: LabelRbm = { W: range(dim).map(() => range(hidden).map(() => .08 * normal(rng))),
    hiddenBias: Array(hidden).fill(0), visibleBias: Array(dim).fill(0),
    U: range(classes).map(() => range(hidden).map(() => .08 * normal(rng))), labelBias: Array(classes).fill(0) };
  const reconstruction: number[] = [];
  const sample = (p: number[]) => p.map(v => Number(rng() < v));
  const categorical = (p: number[]) => { const u = rng(); let s = 0; return p.findIndex((v, i) => { s += v; return u < s || i === p.length - 1; }); };
  for (let epoch = 0; epoch < epochs; epoch++) {
    const dW = zeros(dim, hidden), dU = zeros(classes, hidden), db = Array(hidden).fill(0) as number[];
    const dv = Array(dim).fill(0) as number[], dl = Array(classes).fill(0) as number[];
    let mse = 0;
    X.forEach((v, i) => {
      const label = labels?.[i], ph = rbmHiddenProbabilities(m, v, label), h = sample(ph);
      const pv = m.visibleBias.map((b, j) => sigmoid(b + dot(m.W[j], h))), nv = sample(pv);
      const negativeLabel = classes ? categorical(softmax(m.labelBias.map((b, c) => b + dot(m.U[c], h)))) : undefined;
      const nh = rbmHiddenProbabilities(m, nv, negativeLabel);
      mse += mean(v.map((a, j) => (a - pv[j]) ** 2)) / X.length;
      for (let j = 0; j < hidden; j++) {
        db[j] += ph[j] - nh[j];
        for (let a = 0; a < dim; a++) dW[a][j] += v[a] * ph[j] - nv[a] * nh[j];
        if (label !== undefined) dU[label][j] += ph[j];
        if (negativeLabel !== undefined) dU[negativeLabel][j] -= nh[j];
      }
      for (let a = 0; a < dim; a++) dv[a] += v[a] - nv[a];
      if (label !== undefined) dl[label]++;
      if (negativeLabel !== undefined) dl[negativeLabel]--;
    });
    const rate = .25 / X.length;
    m.W.forEach((row, a) => row.forEach((w, j) => { m.W[a][j] += rate * dW[a][j] - .25 * .0002 * w; }));
    m.U.forEach((row, c) => row.forEach((w, j) => { m.U[c][j] += rate * dU[c][j] - .25 * .0002 * w; }));
    m.hiddenBias.forEach((_, j) => { m.hiddenBias[j] += rate * db[j]; });
    m.visibleBias.forEach((_, j) => { m.visibleBias[j] += rate * dv[j]; });
    m.labelBias.forEach((_, c) => { m.labelBias[c] += rate * dl[c]; });
    reconstruction.push(mse);
  }
  // Exact conditional-likelihood refinement of the top label RBM, not an MLP head.
  const conditionalLoss: number[] = [];
  if (labels) for (let epoch = 0; epoch < 60; epoch++) {
    const dW = zeros(dim, hidden), dU = zeros(classes, hidden), db = Array(hidden).fill(0) as number[];
    const dl = Array(classes).fill(0) as number[];
    let loss = 0;
    X.forEach((v, i) => {
      const p = rbmClassProbabilities(m, v); loss -= Math.log(Math.max(p[labels[i]], 1e-300)) / X.length;
      const h = range(classes).map(c => rbmHiddenProbabilities(m, v, c));
      for (let c = 0; c < classes; c++) {
        const delta = Number(labels[i] === c) - p[c]; dl[c] += delta;
        for (let j = 0; j < hidden; j++) {
          const g = delta * h[c][j]; dU[c][j] += g; db[j] += g;
          for (let a = 0; a < dim; a++) dW[a][j] += v[a] * g;
        }
      }
    });
    const rate = .4 / X.length;
    m.W.forEach((row, a) => row.forEach((_, j) => { m.W[a][j] += rate * dW[a][j]; }));
    m.U.forEach((row, c) => row.forEach((_, j) => { m.U[c][j] += rate * dU[c][j]; }));
    m.hiddenBias.forEach((_, j) => { m.hiddenBias[j] += rate * db[j]; });
    m.labelBias.forEach((_, c) => { m.labelBias[c] += rate * dl[c]; });
    conditionalLoss.push(loss);
  }
  return { model: m, reconstruction, conditionalLoss };
}
function dbnDemo(seed: number): ExperimentResult {
  const train = glyphs(seed, 18), test = glyphs(seed + 9329, 12);
  const architectures = [[12], [12, 9], [12, 9, 7], [24]];
  const results = architectures.map((widths, a) => {
    let inputs = train.X;
    const trained = widths.map((width, l) => {
      const fit = fitRbm(inputs, width, seed + 71 * a + 11 * l, l === widths.length - 1 ? train.y : undefined, 24);
      inputs = inputs.map(x => rbmHiddenProbabilities(fit.model, x));
      return fit;
    });
    const probabilities = (x: number[]) => {
      let v = x;
      for (const fit of trained.slice(0, -1)) v = rbmHiddenProbabilities(fit.model, v);
      return rbmClassProbabilities(trained.at(-1)!.model, v);
    };
    const predictor: Predictor = { scores: probabilities, predict: x => argmax(probabilities(x)) };
    return { trained, probabilities, predictor, count: sum(trained.map(t =>
      t.model.W.flat().length + t.model.U.flat().length + t.model.hiddenBias.length + t.model.visibleBias.length + t.model.labelBias.length)) };
  });
  const labels = architectures.map(w => w.join('→') + ' hidden');
  const first = results[0].trained[0].model, filters = range(6).flatMap(r => [
    range(6 * 4).map(j => first.W[r * 6 + j % 6][Math.floor(j / 6)]),
  ]);
  return { plots: [
    { title: 'Greedy RBM stacks with label-RBM free-energy inference', yLabel: 'Held-out accuracy',
      traces: [bars('Synthetic glyph accuracy', labels, results.map(r => accuracy(r.predictor, test)))] },
    { title: 'Actual trainable parameter counts (wide baseline is not parameter matched)', yLabel: 'Parameters',
      traces: [bars('Weights and biases', labels, results.map(r => r.count))] },
    { title: 'Top label-RBM conditional training loss', xLabel: 'Refinement epoch', yLabel: 'Cross entropy',
      traces: results.map((r, i) => line(labels[i], range(60), r.trained.at(-1)!.conditionalLoss)) },
    { title: 'CD-1 reconstruction diagnostic (not a likelihood bound)', xLabel: 'CD epoch', yLabel: 'Mean pixel squared error',
      traces: results.map((r, i) => line(labels[i], range(24), r.trained[0].reconstruction)) },
    matrixPlot('First four learned 6x6 RBM filters, side by side', filters),
    matrixPlot('Example held-out synthetic glyph', range(6).map(r => test.X[0].slice(6 * r, 6 * r + 6))),
  ], metrics: {
    ...Object.fromEntries(results.flatMap((r, i) => [[`${labels[i]} accuracy`, accuracy(r.predictor, test)],
      [`${labels[i]} parameters`, r.count]])), trainingCases: train.y.length, testCases: test.y.length,
    training: 'Greedy CD-1; exact conditional likelihood refinement of top label RBM only',
  }, checks: [
    check('Label-RBM exact hidden marginal posteriors normalize', results.every(r => probabilityCheck(test.X.map(r.probabilities)))),
    check('Bernoulli hidden conditionals remain in [0,1]', results.every(r => r.trained.every(t =>
      rbmHiddenProbabilities(t.model, t.model.visibleBias.map(() => 0)).every(p => p >= 0 && p <= 1)))),
    check('Every top RBM uses categorical label-visible units', results.every(r => r.trained.at(-1)!.model.U.length === 3)),
    check('Top-RBM conditional fitting improves training cross entropy', results.every(r => {
      const losses = r.trained.at(-1)!.conditionalLoss; return losses.at(-1)! < losses[0];
    })),
  ], notes: ['Synthetic binary 6x6 line glyphs, NOT MNIST. Widths 12 / 12→9 / 12→9→7 and a 24-unit shallow baseline.',
    'Actual Bernoulli-Bernoulli RBMs: positive statistics minus a sampled one-step Gibbs negative phase; categorical labels only at the top.',
    'Lower layers supply mean hidden activations. The top RBM additionally receives conditional-likelihood refinement; no wake-sleep or whole-stack fine tuning.',
    'Greedy DBN semantics are retained, but neither calibrated digit recognition nor monotonic generative likelihood improvement is claimed.'] };
}

export type TinyCnn = { filters: Matrix; bias: number[]; head: Matrix; headBias: number[] };
/** Valid 3x3 cross-correlation → tanh → 2x2 average pool → softmax. */
export function cnnForward(m: TinyCnn, image: number[]) {
  const conv = m.filters.map((w, f) => range(16).map(p => {
    const r = Math.floor(p / 4), c = p % 4;
    return Math.tanh(m.bias[f] + sum(w.map((v, j) => v * image[(r + Math.floor(j / 3)) * 6 + c + j % 3])));
  }));
  const pooled = conv.flatMap(row => range(4).map(p => {
    const r = Math.floor(p / 2) * 2, c = p % 2 * 2;
    return (row[r * 4 + c] + row[r * 4 + c + 1] + row[(r + 1) * 4 + c] + row[(r + 1) * 4 + c + 1]) / 4;
  }));
  const probabilities = softmax(m.head.map((w, c) => dot(w, pooled) + m.headBias[c]));
  return { conv, pooled, probabilities };
}
export function cnnGradient(m: TinyCnn, image: number[], label: number) {
  const forward = cnnForward(m, image), delta = forward.probabilities.map((v, c) => v - Number(c === label));
  const head = delta.map(v => forward.pooled.map(p => v * p));
  const pooledGradient = forward.pooled.map((_, j) => sum(delta.map((v, c) => v * m.head[c][j])));
  const filters = zeros(m.filters.length, 9), bias = m.bias.map(() => 0);
  m.filters.forEach((_, f) => {
    for (let p = 0; p < 16; p++) {
      const r = Math.floor(p / 4), c = p % 4, pool = Math.floor(r / 2) * 2 + Math.floor(c / 2);
      const g = pooledGradient[f * 4 + pool] * .25 * (1 - forward.conv[f][p] ** 2);
      bias[f] += g;
      for (let j = 0; j < 9; j++) filters[f][j] += g * image[(r + Math.floor(j / 3)) * 6 + c + j % 3];
    }
  });
  return { filters, bias, head, headBias: delta, loss: -Math.log(Math.max(1e-300, forward.probabilities[label])) };
}
function cnnDemo(seed: number): ExperimentResult {
  const rng = seededRandom(seed), train = glyphs(seed + 19, 24, true), test = glyphs(seed + 991, 12, true);
  const model: TinyCnn = { filters: range(3).map(() => range(9).map(() => .2 * normal(rng))),
    bias: [0, 0, 0], head: range(3).map(() => range(12).map(() => .1 * normal(rng))), headBias: [0, 0, 0] };
  const initialFilters = model.filters.map(row => [...row]), loss: number[] = [];
  for (let epoch = 0; epoch < 110; epoch++) {
    const g: TinyCnn = { filters: zeros(3, 9), bias: [0, 0, 0], head: zeros(3, 12), headBias: [0, 0, 0] };
    let total = 0;
    train.X.forEach((x, i) => {
      const grad = cnnGradient(model, x, train.y[i]); total += grad.loss / train.X.length;
      for (let f = 0; f < 3; f++) {
        g.bias[f] += grad.bias[f]; g.headBias[f] += grad.headBias[f];
        for (let j = 0; j < 9; j++) g.filters[f][j] += grad.filters[f][j];
        for (let j = 0; j < 12; j++) g.head[f][j] += grad.head[f][j];
      }
    });
    loss.push(total);
    const rate = .65 / train.X.length;
    for (let f = 0; f < 3; f++) {
      model.bias[f] -= rate * g.bias[f]; model.headBias[f] -= rate * g.headBias[f];
      for (let j = 0; j < 9; j++) model.filters[f][j] -= rate * g.filters[f][j];
      for (let j = 0; j < 12; j++) model.head[f][j] -= rate * g.head[f][j];
    }
  }
  const predictor: Predictor = { scores: x => cnnForward(model, x).probabilities,
    predict: x => argmax(cnnForward(model, x).probabilities) };
  const sample = cnnForward(model, test.X[0]);
  return { plots: [
    { title: 'Actual end-to-end CNN training', xLabel: 'Full-batch epoch', yLabel: 'Cross entropy',
      traces: [line('Training cross entropy', range(loss.length), loss)] },
    matrixPlot('Held-out 6x6 glyph', range(6).map(r => test.X[0].slice(r * 6, r * 6 + 6))),
    matrixPlot('Learned 3x3 shared convolution filters', range(3).map(r => range(9).map(j =>
      model.filters[Math.floor(j / 3)][r * 3 + j % 3]))),
    matrixPlot('Tanh convolution feature map: filter 0', range(4).map(r => sample.conv[0].slice(r * 4, r * 4 + 4))),
    matrixPlot('2x2 average-pooled feature map: filter 0', [sample.pooled.slice(0, 2), sample.pooled.slice(2, 4)]),
    { title: 'Held-out sample posterior', yLabel: 'Probability',
      traces: [bars('Softmax', ['Vertical', 'Horizontal', 'Diagonal'], sample.probabilities)] },
  ], metrics: { trainAccuracy: accuracy(predictor, train), testAccuracy: accuracy(predictor, test),
    initialCrossEntropy: loss[0], finalCrossEntropy: loss.at(-1)!, parameters: 69,
    trainingCases: train.y.length, testCases: test.y.length,
    convolutionWeightMovement: Math.sqrt(sum(model.filters.flatMap((row, f) => row.map((v, j) => (v - initialFilters[f][j]) ** 2)))) },
  checks: [check('CNN softmax posterior normalization', probabilityCheck(test.X.map(x => cnnForward(model, x).probabilities))),
    check('Convolution filters really trained', model.filters.some((row, f) => row.some((v, j) => Math.abs(v - initialFilters[f][j]) > 1e-4))),
    check('CNN cross entropy improved', loss.at(-1)! < loss[0]),
    check('Pooling is an exact four-cell mean', Math.abs(sample.pooled[0] -
      (sample.conv[0][0] + sample.conv[0][1] + sample.conv[0][4] + sample.conv[0][5]) / 4) < 1e-12)],
  notes: ['Original matconvnetDemo only invokes a machine-specific native compilation, with no dataset/training/inference.',
    'Alternative: self-contained 3-filter trainable CNN, 6x6 synthetic translated/noisy line glyphs, NOT MNIST or MatConvNet outputs.',
    'Standard CNN cross-correlation, tanh, nonoverlapping average pooling, and a trained softmax head; gradients propagate into shared filters.',
    '69 trainable parameters; no network, native libraries, image files, or installers.'] };
}

export function hopfieldWeights(patterns: Matrix) {
  return range(patterns[0].length).map(i => range(patterns[0].length).map(j =>
    i === j ? 0 : sum(patterns.map(p => p[i] * p[j])) / patterns[0].length));
}
export const hopfieldEnergy = (W: Matrix, state: number[]) => -.5 * sum(W.map((row, i) => state[i] * dot(row, state)));
export function recallHopfield(W: Matrix, cue: number[], sweeps = 12) {
  const state = [...cue], energies = [hopfieldEnergy(W, state)], snapshots = [[...state]];
  for (let t = 0; t < sweeps; t++) {
    let changes = 0;
    for (let i = 0; i < state.length; i++) {
      const field = dot(W[i], state), next = field > 1e-12 ? 1 : field < -1e-12 ? -1 : state[i];
      if (next !== state[i]) changes++;
      state[i] = next; energies.push(hopfieldEnergy(W, state));
    }
    snapshots.push([...state]);
    if (!changes) break;
  }
  return { state, energies, snapshots };
}
function hopfieldDemo(seed: number): ExperimentResult {
  const patterns = range(3).map(p => range(64).map(j => {
    const r = Math.floor(j / 8), c = j % 8;
    return p === 0 ? (r < 4 ? 1 : -1) : p === 1 ? (c < 4 ? 1 : -1) : ((r < 4) === (c < 4) ? 1 : -1);
  }));
  const rng = seededRandom(seed), W = hopfieldWeights(patterns);
  const cues = patterns.map(pattern => {
    const cue = pattern.map((v, i) => i % 8 < 2 ? -1 : v);
    // Two additional flips outside the occluded quarter.
    const ids = shuffled(64, rng).filter(i => i % 8 >= 2).slice(0, 2);
    ids.forEach(i => { cue[i] *= -1; }); return cue;
  });
  const retrievals = cues.map(cue => recallHopfield(W, cue)), mismatch = (a: number[], b: number[]) => sum(a.map((v, i) => Number(v !== b[i])));
  const mosaic = [patterns, cues, retrievals.map(r => r.state)].flatMap(row => range(8).map(r =>
    row.flatMap(image => image.slice(r * 8, r * 8 + 8))));
  return { plots: [
    matrixPlot('Rows of panels: stored / quarter-occluded + 2 flips / retrieved', mosaic),
    { title: 'Hopfield Lyapunov energy under asynchronous single-neuron updates', xLabel: 'Neuron update', yLabel: 'E = -½sᵀWs',
      traces: retrievals.map((r, i) => line(`Memory ${i + 1}`, range(r.energies.length), r.energies)) },
    { title: 'Actual Hamming errors to each target', yLabel: 'Wrong bipolar pixels',
      traces: [bars('Cue', ['Pattern 1', 'Pattern 2', 'Pattern 3'], cues.map((c, i) => mismatch(c, patterns[i]))),
        bars('Retrieved', ['Pattern 1', 'Pattern 2', 'Pattern 3'], retrievals.map((r, i) => mismatch(r.state, patterns[i])))] },
  ], metrics: { memories: 3, neurons: 64,
    meanCueHamming: mean(cues.map((c, i) => mismatch(c, patterns[i]))),
    meanRetrievedHamming: mean(retrievals.map((r, i) => mismatch(r.state, patterns[i]))),
    maximumEnergyIncrease: Math.max(0, ...retrievals.flatMap(r => r.energies.slice(1).map((v, i) => v - r.energies[i]))) },
  checks: [check('Hebbian W is symmetric with zero self-coupling', W.every((row, i) => row[i] === 0 && row.every((v, j) => v === W[j][i]))),
    check('Asynchronous Hopfield energy never increases', retrievals.every(r => r.energies.slice(1).every((v, i) => v <= r.energies[i] + 1e-10))),
    check('Retrieved states are single-neuron fixed points', retrievals.every(r => W.every((row, i) => r.state[i] * dot(row, r.state) >= -1e-10))),
    check('All three corrupted cues recover their stored pattern', retrievals.every((r, i) => mismatch(r.state, patterns[i]) === 0))],
  notes: ['Three orthogonal synthetic 8x8 bipolar bar/checker patterns replace seven downloaded 30x30 images.',
    'Hebbian outer-product weights replace newhop; quarter occlusion plus two flips replaces 50% occlusion.',
    'Zero field retains the previous state. Sequential asynchronous updates give the tested Lyapunov-energy guarantee.'] };
}

export const hamming = (a: number[], b: number[]) => sum(a.map((v, i) => Number(v !== b[i])));
export function codePosterior(codes: Matrix, prior: number[], guess: number[], distance: number) {
  const mass = prior.map((p, i) => hamming(codes[i], guess) === distance ? p : 0), evidence = sum(mass);
  if (!(evidence > 0)) throw new RangeError('Impossible Hamming-distance evidence');
  return { posterior: mass.map(v => v / evidence), evidence };
}
function codeDemo(seed: number): ExperimentResult {
  const rng = seededRandom(seed), codes = range(27).map(i => [Math.floor(i / 9), Math.floor(i / 3) % 3, i % 3]);
  const secret = codes[Math.floor(rng() * codes.length)];
  let posterior = codes.map(() => 1 / codes.length), incumbent = 3;
  const queries: number[] = [], responses: number[] = [], support = [codes.length], entropy = [Math.log2(codes.length)];
  const history: Matrix = [[...posterior]];
  let acquisition: number[] = [], expected: number[] = [];
  for (let t = 0; t < codes.length; t++) {
    expected = codes.map(x => sum(posterior.map((p, i) => p * hamming(x, codes[i]))));
    acquisition = codes.map(x => sum(posterior.map((p, i) => p * Math.max(0, incumbent - hamming(x, codes[i])))));
    const candidates = range(codes.length).filter(i => !queries.includes(i));
    // Expected improvement first; posterior probability then expected distance break ties.
    candidates.sort((a, b) => acquisition[b] - acquisition[a] || posterior[b] - posterior[a] || expected[a] - expected[b] || a - b);
    const query = candidates[0], response = hamming(codes[query], secret);
    queries.push(query); responses.push(response); incumbent = Math.min(incumbent, response);
    posterior = codePosterior(codes, posterior, codes[query], response).posterior;
    history.push([...posterior]); support.push(posterior.filter(p => p > 0).length);
    entropy.push(-sum(posterior.filter(p => p > 0).map(p => p * Math.log2(p))));
    if (!response) break;
  }
  const decoded = codes[argmax(posterior)], labels = codes.map(c => c.join(''));
  return { plots: [
    { title: 'Exact Bayesian code inference', xLabel: 'Number of oracle queries', yLabel: 'Count / bits',
      traces: [line('Surviving codes', range(support.length), support), line('Posterior entropy (bits)', range(entropy.length), entropy)] },
    { title: 'Last pre-query surrogate vs revealed objective', xLabel: 'Candidate code (zero-based symbols)', yLabel: 'Hamming distance / improvement',
      traces: [{ ...line('Posterior expected Hamming distance', range(27), expected), x: labels },
        { ...line('Expected improvement acquisition', range(27), acquisition), x: labels },
        { ...line('True objective (display only)', range(27), codes.map(c => hamming(c, secret))), x: labels }] },
    { title: 'Decoded posterior', yLabel: 'Probability', traces: [bars('Exact posterior', labels, posterior)] },
    { title: 'Actual oracle responses', xLabel: 'Query', yLabel: 'Hamming distance',
      traces: [line('Observed Hamming distance', range(responses.length).map(i => i + 1), responses)] },
  ], metrics: { secret: secret.join(''), decoded: decoded.join(''), queries: queries.length,
    finalEntropyBits: entropy.at(-1)!, finalSupport: support.at(-1)!, decodedHamming: hamming(decoded, secret),
    acquisition: 'Exact posterior expected improvement; deterministic ties' },
  checks: [check('Every Bayesian posterior normalizes', probabilityCheck(history)),
    check('Every update preserves the true code in support', history.every(p => p[codes.indexOf(secret)] > 0)),
    check('Deterministic evidence cannot increase support', support.slice(1).every((v, i) => v <= support[i])),
    check('Decoded code exactly matches hidden code', hamming(decoded, secret) === 0 && responses.at(-1) === 0),
    check('No repeated oracle queries', new Set(queries).size === queries.length)],
  notes: ['Bounded 3-slot, 3-symbol code; uniform prior. The original default main stops at a debugging prompt with a 2-slot prior.',
    'Likelihood is the exact observed Hamming distance, not Mastermind color feedback or a substitution cipher.',
    'True secret is used only by the oracle and display/evaluation; acquisition sees the posterior and responses, never the secret.'] };
}

function regressionPackage(seed: number): ExperimentResult {
  const rng = seededRandom(seed), X = range(110).map(() => range(4).map(() => normal(rng)));
  const truth = [1.1, 1.7, -.8, .35, 0], y = X.map(x => dot([1, ...x], truth) + .28 * normal(rng));
  const train: Data = { X: X.slice(0, 80), y: y.slice(0, 80) }, test: Data = { X: X.slice(80), y: y.slice(80) };
  const lambdas = [0, .01, .1, 1, 10];
  // Regression folds are by index, not by the continuous response value.
  const cv = lambdas.map(lambda => mean(range(3).map(f => {
    const fitIds = range(80).filter(i => i % 3 !== f), valid = range(80).filter(i => i % 3 === f);
    const model = linearFit(fitIds.map(i => [1, ...train.X[i]]), fitIds.map(i => train.y[i]), lambda);
    return mean(valid.map(i => (dot([1, ...train.X[i]], model.coefficients) - train.y[i]) ** 2));
  })));
  const lambda = lambdas[argmax(cv.map(v => -v))], design = train.X.map(x => [1, ...x]);
  const fit = linearFit(design, train.y, lambda);
  const serialized = JSON.stringify({ format: 'independent-linear-model-v1', interceptIncluded: true, coefficients: fit.coefficients });
  const restored = JSON.parse(serialized) as { coefficients: number[] };
  const prediction = test.X.map(x => dot([1, ...x], restored.coefficients));
  const rmse = Math.sqrt(mean(prediction.map((v, i) => (v - test.y[i]) ** 2)));
  const baseline = Math.sqrt(mean(test.y.map(v => (v - mean(train.y)) ** 2)));
  const order = range(test.y.length).sort((a, b) => test.y[a] - test.y[b]);
  const normalResidual = Math.max(...range(5).map(j => Math.abs(
    sum(design.map((row, i) => row[j] * (fit.fitted[i] - train.y[i]))) + (j ? lambda * fit.coefficients[j] : 0))));
  return { plots: [
    { title: 'Local learn → serialize → predict educational package', xLabel: 'Held-out sample sorted by observed response', yLabel: 'Response',
      traces: [scatter('Observed', range(order.length), order.map(i => test.y[i])),
        line('Reloaded model prediction', range(order.length), order.map(i => prediction[i]))] },
    { title: 'Held-out residuals', xLabel: 'Prediction', yLabel: 'Observed minus predicted',
      traces: [scatter('Held-out residual', prediction, test.y.map((v, i) => v - prediction[i]))] },
    { title: 'Training-only ridge selection', xLabel: 'Ridge lambda', yLabel: '3-fold MSE',
      traces: [line('Validation MSE', lambdas, cv)] },
    { title: 'Learned linear coefficients', yLabel: 'Coefficient',
      traces: [bars('Known generating coefficients', ['Intercept', 'x1', 'x2', 'x3', 'x4'], truth),
        bars('Fitted', ['Intercept', 'x1', 'x2', 'x3', 'x4'], fit.coefficients)] },
  ], metrics: { selectedLambda: lambda, testRmse: rmse, constantBaselineRmse: baseline, trainingRmse: fit.rmse,
    penalizedNormalEquationResidual: normalResidual, trainingCases: 80, heldOutCases: 30,
    package: 'In-memory JSON model; no MLComp deployment' },
  checks: [check('Penalized least-squares normal equations', normalResidual < 1e-8),
    check('Serialization leaves inference unchanged', prediction.every((v, i) => v === dot([1, ...test.X[i]], fit.coefficients))),
    check('Held-out regression beats training-mean baseline', rmse < baseline),
    check('Intercept is explicitly present and unpenalized', restored.coefficients.length === 5)],
  notes: ['Synthetic Gaussian covariates and noisy linear targets replace prostate data.',
    'Local in-memory training, JSON serialization, reload, and held-out prediction replace Octave dependency bundling/MLComp upload.',
    'No external service, file generation, compiler, or network access. Ridge uses QR with an unpenalized intercept.'] };
}

function definition(id: string, title: string, method: string, description: string, differences: string[],
  run: (seed: number) => ExperimentResult): Reproduction {
  return { id, title, source: `demos/${id}.m`, method, description, differences, run };
}

export const classificationReproductions: Reproduction[] = [
  definition('classificationShootout', 'Classifier shootout: joint kernel selection',
    'Training-only stratified 3-fold selection: linear L2 softmax, Gaussian NB, RBF kernel ridge, RBF SVM (SMO)',
    'Compare measured test errors and fitted complexity on generated nonlinear rings and three-class Gaussian data.',
    ['Synthetic data replace all six benchmark datasets.', 'A bounded 2×2 kernel grid replaces the original hours-long 5-fold search.',
      'RVM and sparse multinomial kernel regression are not implemented or scored; actual alternatives are named.',
      'No original timing, sparsity, or accuracy claims.'], seed => shootout(seed, false)),
  definition('classificationShootoutCvLambdaOnly', 'Fixed-kernel regularization shootout',
    'Training median-distance RBF bandwidth; lambda-only 3-fold CV for L1/L2 RBF-basis softmax and kernel ridge; linear sparse-data task',
    'Separate fixed-bandwidth comparison, including high-dimensional sparse-signal data with linear models.',
    ['Synthetic rings and 12-dimensional sparse-signal data replace eight benchmarks.',
      'Training-only median-distance bandwidth replaces SVM bandwidth selection on the full original dataset.',
      'Actual L1/L2 softmax and ridge models replace original SVM/RVM/SMLR/RMLR lineup; no ARD claims.'], seed => shootout(seed, true)),
  definition('linearKernelDemo', 'Repeated linear classifier comparison',
    'Linear SVM SMO, linear kernel ridge, proximal L1 and L2 multinomial logistic regression',
    'Compare held-out errors across three seeded trials and expose algorithm-specific active-model counts.',
    ['Synthetic 3-class blobs and sparse 12-D signals replace soy/fglass/colon/AML.', 'Fixed disclosed regularization replaces CV/ARD.',
      'No RVM; no native solver timing or boxplot. Three independent trials use grouped bars.'], linearComparison),
  definition('dtreeDemoIris', 'CART complexity selection on synthetic classes',
    'Greedy weighted-Gini CART; stratified 3-fold maximum-depth selection using one-standard-error rule',
    'Visualize selected and deeper tree regions, validation error, and actual test performance.',
    ['Generated Gaussian observations are NOT iris measurements.', 'Depth-limited refitting replaces cost-complexity pruning.',
      'Three folds replace ten; no toolbox tree GUI.'], treeDemo),
  definition('ldaQdaDemoIris', 'LDA versus QDA on synthetic classes',
    'Full-covariance Gaussian discriminant analysis: pooled LDA vs class-specific QDA, diagonal shrinkage .03',
    'Show affine versus quadratic decision geometry, confusion counts, and held-out/CV errors.',
    ['Synthetic Gaussian classes, NOT Fisher iris.', 'Explicit covariance shrinkage and 3-fold CV replace original toolbox defaults.'], discriminantDemo),
  definition('kernelBinaryClassifDemo', 'Sparse/dense kernel logistic and SVM boundaries',
    'Proximal L1/L2 softmax on RBF features; genuine soft-margin RBF SVM via SMO',
    'Show three actually trained nonlinear boundaries and algorithm-specific sparsity on held-out noisy rings.',
    ['Synthetic rings replace bishop2class.', 'RVM omitted; standardized unit-amplitude RBF differs from original kernelRbfSigma.',
      'Fixed bounded training; no external SVM dependency.'], kernelComparison),
  definition('svmFitTest', 'SVM kernels, epsilon regression, and multiclass',
    'One TypeScript SMO solver with linear/cubic/RBF kernels; epsilon-SVR coordinate descent; one-vs-rest multiclass',
    'Exercise classification kernel selection, real epsilon-insensitive regression, and multiclass score dispatch.',
    ['Synthetic classification/regression datasets replace crabs, prostate and soy.', 'No native-backend equivalence/timing claims.',
      'SVR regularizes the intercept and uses a linear kernel; bounded iterations report residuals rather than promise exact convergence.'], svmDemo),
  definition('svmOneVsRestDemo', 'One-vs-rest signed-margin dispatch',
    'Three binary linear soft-margin SVMs, deterministic SMO, multiclass argmax',
    'Inspect signed margins and confusion, and verify wrapper predictions against explicit maximum-score dispatch.',
    ['Synthetic classes replace soy.', 'Dispatch consistency is tested; liblinear backend equivalence is explicitly omitted.'], oneVsRest),
  definition('deepBelNetClassifyDemo', 'Actual small label-RBM deep belief networks',
    'Greedy Bernoulli RBM stacks with sampled CD-1, categorical top-label RBM, exact hidden-marginal inference and top conditional refinement',
    'Compare 1/2/3-layer generative RBM stacks and a wider shallow label RBM on noisy generated glyphs.',
    ['Synthetic binary 6x6 glyphs, NOT MNIST.', 'Widths 12 / 12→9 / 12→9→7; wide 24-unit baseline is not parameter matched.',
      '24 CD epochs per layer, then 60 conditional updates of top label RBM; no full-stack fine tuning or native library.',
      'Accuracy, cross entropy, parameters, and reconstruction replace runtime benchmarking.'], dbnDemo),
  definition('matconvnetDemo', 'Self-contained tiny trainable CNN',
    '3 shared 3x3 valid convolution filters, tanh, 2x2 average pooling, softmax; end-to-end analytic backpropagation',
    'Replace a machine-specific library compilation command with an explicit bounded CNN learning experiment.',
    ['Original only compiles external MatConvNet; this is a changed educational workload, not compilation parity.',
      '6x6 synthetic translated glyphs, 69 parameters, 110 full-batch epochs; no downloads/native code.'], cnnDemo),
  definition('hopfieldDemo', 'Hopfield associative retrieval and energy',
    'Hebbian symmetric zero-diagonal weights; asynchronous bipolar updates and measured Lyapunov energy',
    'Store and retrieve three corrupted patterns, rendering images as square scatter cells.',
    ['Three orthogonal 8x8 synthetic patterns replace seven external images.', 'Quarter occlusion plus two flips replaces half occlusion.',
      'Outer-product learning replaces toolbox newhop; no image/neural toolbox.'], hopfieldDemo),
  definition('codeBreaker', 'Bayesian Hamming-code optimization and decoding',
    'Exact finite Bayesian posterior, deterministic Hamming likelihood, posterior expected-improvement acquisition',
    'Infer a hidden three-symbol code through real oracle queries and display posterior contraction and the decoded code.',
    ['3 slots × 3 symbols with uniform prior replaces original default 2-slot hinted prior/debug prompt.',
      'No cubic likelihood tensor: likelihood is computed on demand.', 'This is Hamming-code optimization, not text cryptanalysis.'], codeDemo),
  definition('linregMlcompDemo', 'Local regression model packaging and inference',
    'QR ridge regression with 3-fold lambda selection, in-memory JSON serialization/reload, held-out inference',
    'Reproduce the learn/package/predict outcome locally, including normal-equation and serialization checks.',
    ['Synthetic 4-D linear data replace prostate.', 'Local JSON packaging replaces Octave dependency compiler and remote MLComp service.',
      'No filesystem/service side effects or deployment claim.'], regressionPackage),
];
