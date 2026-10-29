/** Bounded, independent TypeScript experiments, NOT outputs of the MATLAB demos. */
import type { Reproduction, ExperimentResult, VisualPlot } from './types.js';
import { dot, line, matrixPlot, mean, norm, normal, normalize, range, scatter, seededRandom,
  sigmoid, softThreshold, solve, sum, symmetricEigen, zeros } from './math.js';
import { gaussianEM, linearFit, logGamma, logSumExp } from '../numerics.js';
import type { GaussianInitial } from '../numerics.js';

const grid = (lo: number, hi: number, n = 161) => range(n).map(i => lo + (hi - lo) * i / (n - 1));
const maxAbs = (x: number[]) => Math.max(...x.map(Math.abs));
const monotone = (x: number[], direction = -1, tolerance = 1e-8) =>
  x.slice(1).every((v, i) => direction * (v - x[i]) >= -tolerance);
const check = (name: string, passed: boolean, value: number, tolerance: string) =>
  ({ name, passed, detail: `Measured ${value.toPrecision(7)}; ${tolerance}` });
const curvePlot = (title: string, xLabel: string, yLabel: string, traces: VisualPlot['traces']): VisualPlot =>
  ({ title, xLabel, yLabel, traces });
const normalPDF = (x: number, mu = 0, variance = 1) =>
  Math.exp(-.5 * (x - mu) ** 2 / variance) / Math.sqrt(2 * Math.PI * variance);

function histogram(data: number[], lo: number, hi: number, bins = 36) {
  const width = (hi - lo) / bins, counts = Array<number>(bins).fill(0);
  for (const x of data) {
    const b = Math.floor((x - lo) / width);
    if (b >= 0 && b < bins) counts[b]++;
  }
  return { x: range(bins).map(i => lo + (i + .5) * width),
    y: counts.map(c => c / (data.length * width)), width };
}

/**
 * Gilks--Wild ARS: tangent upper hull, chord squeeze, exact piecewise-exponential
 * proposals and rejection correction. Unbounded tails are integrated, not clipped.
 * The supplied log density must be differentiable and strictly log-concave.
 */
export function adaptiveRejection(logf: (x: number) => number, derivative: (x: number) => number,
  initial: number[], domain: [number, number], count: number, rng: () => number) {
  const knots = [...initial].sort((a, b) => a - b);
  const samples: number[] = [];
  let proposals = 0, evaluations = 0, squeezed = 0, maxEnvelopeViolation = 0;
  const hull = () => {
    const h = knots.map(logf), slopes = knots.map(derivative);
    if (slopes.some((s, i) => i > 0 && s >= slopes[i - 1]) ||
      domain[0] === -Infinity && slopes[0] <= 0 ||
      domain[1] === Infinity && slopes.at(-1)! >= 0) throw new RangeError('ARS requires a concave, integrable hull');
    const intercept = h.map((v, i) => v - slopes[i] * knots[i]);
    const z = [domain[0], ...knots.slice(1).map((_, j) =>
      (intercept[j + 1] - intercept[j]) / (slopes[j] - slopes[j + 1])), domain[1]];
    const logMass = slopes.map((s, i) => {
      const l = z[i], r = z[i + 1];
      if (Math.abs(s) < 1e-14) return intercept[i] + Math.log(r - l);
      if (s > 0) return intercept[i] + s * r + Math.log(-Math.expm1(s * (l - r))) - Math.log(s);
      return intercept[i] + s * l + Math.log(-Math.expm1(s * (r - l))) - Math.log(-s);
    });
    const total = logSumExp(logMass);
    return { h, slopes, intercept, z, probabilities: logMass.map(v => Math.exp(v - total)) };
  };
  let envelope = hull();
  while (samples.length < count && proposals < count * 30 + 100) {
    proposals++;
    let c = rng(), j = 0;
    while (j < knots.length - 1 && c > envelope.probabilities[j]) c -= envelope.probabilities[j++];
    const s = envelope.slopes[j], l = envelope.z[j], r = envelope.z[j + 1];
    const u = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, rng()));
    const x = Math.abs(s) < 1e-14 ? l + u * (r - l) : s > 0
      ? r + Math.log(u + (1 - u) * Math.exp(s * (l - r))) / s
      : l + Math.log(1 - u + u * Math.exp(s * (r - l))) / s;
    const upper = envelope.intercept[j] + s * x;
    let lower = -Infinity;
    const k = knots.findIndex(t => t >= x);
    if (k > 0) lower = envelope.h[k - 1] + (x - knots[k - 1]) *
      (envelope.h[k] - envelope.h[k - 1]) / (knots[k] - knots[k - 1]);
    const logu = Math.log(Math.max(Number.EPSILON, rng()));
    if (logu <= lower - upper) { samples.push(x); squeezed++; continue; }
    const target = logf(x);
    evaluations++;
    maxEnvelopeViolation = Math.max(maxEnvelopeViolation, target - upper);
    if (logu <= target - upper) samples.push(x);
    // A fixed hull remains a valid rejection envelope after this memory bound.
    if (knots.length < 96 && knots.every(t => Math.abs(t - x) > 1e-8)) {
      knots.push(x); knots.sort((a, b) => a - b); envelope = hull();
    }
  }
  if (samples.length !== count) throw new Error('ARS proposal budget exhausted');
  return { samples, proposals, evaluations, squeezed, knots, maxEnvelopeViolation };
}

export function rosenbrock(x: number[]) {
  const g = Array<number>(x.length).fill(0), h = zeros(x.length, x.length);
  let value = 0;
  for (let i = 0; i < x.length - 1; i++) {
    const r = x[i + 1] - x[i] ** 2;
    value += (1 - x[i]) ** 2 + 100 * r * r;
    g[i] += -400 * x[i] * r + 2 * (x[i] - 1);
    g[i + 1] += 200 * r;
    h[i][i] += 1200 * x[i] ** 2 - 400 * x[i + 1] + 2;
    h[i + 1][i + 1] += 200;
    h[i][i + 1] = h[i + 1][i] = -400 * x[i];
  }
  return { value, g, h };
}
type Objective = (x: number[]) => { value: number; g: number[]; h: number[][] };

/** Modified Newton direction plus Armijo backtracking (also enforces barrier domains). */
export function newtonMinimize(objective: Objective, start: number[], maxIterations = 100) {
  let x = [...start], current = objective(x), evaluations = 1;
  const path = [[...x]], values = [current.value];
  for (let iteration = 0; iteration < maxIterations && norm(current.g) > 2e-8; iteration++) {
    let direction = current.g.map(v => -v), damping = 0;
    for (let attempt = 0; attempt < 18; attempt++) {
      try {
        const h = current.h.map((row, i) => row.map((v, j) => v + (i === j ? damping : 0)));
        const p = solve(h, current.g.map(v => -v));
        if (dot(p, current.g) < -1e-12 * norm(p) * norm(current.g)) { direction = p; break; }
      } catch { /* singular Hessian: increase positive diagonal shift */ }
      damping = damping === 0 ? 1e-4 : damping * 10;
    }
    let alpha = 1, accepted = false;
    for (let backtrack = 0; backtrack < 45; backtrack++) {
      const proposal = x.map((v, i) => v + alpha * direction[i]);
      const next = objective(proposal); evaluations++;
      if (Number.isFinite(next.value) && next.value <= current.value + 1e-4 * alpha * dot(current.g, direction)) {
        x = proposal; current = next; accepted = true; break;
      }
      alpha *= .5;
    }
    if (!accepted) break;
    path.push([...x]); values.push(current.value);
  }
  return { x, ...current, path, values, evaluations };
}

function finiteDifferenceHessian(x: number[]) {
  const h = zeros(x.length, x.length), epsilon = 1e-5;
  for (let j = 0; j < x.length; j++) {
    const plus = [...x], minus = [...x]; plus[j] += epsilon; minus[j] -= epsilon;
    const gp = rosenbrock(plus).g, gm = rosenbrock(minus).g;
    for (let i = 0; i < x.length; i++) h[i][j] = (gp[i] - gm[i]) / (2 * epsilon);
  }
  return h;
}

/** A genuine inverse-Hessian BFGS update, not a rescaled Newton trajectory. */
export function bfgsRosenbrock(start: number[], maxIterations = 180) {
  let x = [...start], current = rosenbrock(x), inverse = zeros(x.length, x.length);
  range(x.length).forEach(i => { inverse[i][i] = 1; });
  const path = [[...x]], values = [current.value];
  for (let k = 0; k < maxIterations && norm(current.g) > 1e-7; k++) {
    let p = inverse.map(row => -dot(row, current.g));
    if (dot(p, current.g) >= 0) p = current.g.map(v => -v);
    let step = 1, next = current, nextX = x;
    for (let b = 0; b < 40; b++) {
      nextX = x.map((v, i) => v + step * p[i]); next = rosenbrock(nextX);
      if (next.value <= current.value + 1e-4 * step * dot(p, current.g)) break;
      step *= .5;
    }
    const s = nextX.map((v, i) => v - x[i]), y = next.g.map((v, i) => v - current.g[i]);
    const sy = dot(s, y);
    if (sy > 1e-14) {
      const by = inverse.map(row => dot(row, y)), yby = dot(y, by);
      inverse = inverse.map((row, i) => row.map((v, j) =>
        v + (1 + yby / sy) * s[i] * s[j] / sy - (s[i] * by[j] + by[i] * s[j]) / sy));
    }
    x = nextX; current = next; path.push([...x]); values.push(current.value);
  }
  return { x, ...current, path, values };
}

export function constrainedRosenbrock() {
  let x = [-.8 / Math.sqrt(5), 1.6 / Math.sqrt(5)];
  const path = [[...x]], barrierValues: number[] = [];
  let mu = 1;
  for (let stage = 0; stage <= 10; stage++) {
    mu = .25 ** stage;
    const barrier: Objective = t => {
      const base = rosenbrock(t), slack = 1 - dot(t, t);
      if (slack <= 0) return { ...base, value: Infinity };
      return { value: base.value - mu * Math.log(slack),
        g: base.g.map((v, i) => v + 2 * mu * t[i] / slack),
        h: base.h.map((row, i) => row.map((v, j) =>
          v + (i === j ? 2 * mu / slack : 0) + 4 * mu * t[i] * t[j] / slack ** 2)) };
    };
    const fit = newtonMinimize(barrier, x, 55);
    x = fit.x; path.push(...fit.path.slice(1)); barrierValues.push(rosenbrock(x).value);
  }
  const slack = 1 - dot(x, x), lambda = mu / slack, final = rosenbrock(x);
  return { x, path, value: final.value, slack, lambda, mu, barrierValues,
    stationarity: norm(final.g.map((v, i) => v + 2 * lambda * x[i])) };
}

function rosenLandscape(pathTraces: VisualPlot['traces'], disk = false): VisualPlot {
  const xs: number[] = [], ys: number[] = [], color: number[] = [];
  for (const x of grid(-1.6, 1.6, 37)) for (const y of grid(-.7, 2.2, 35)) {
    if (disk && x * x + y * y > 1) continue;
    xs.push(x); ys.push(y); color.push(Math.log10(1 + rosenbrock([x, y]).value));
  }
  return curvePlot('Rosenbrock landscape: log10(1 + objective)', 'x₁', 'x₂', [{
    ...scatter('Objective grid', xs, ys),
    marker: { symbol: 'square', size: 7, color, colorscale: 'Viridis', showscale: true },
  }, ...pathTraces]);
}
const pathTrace = (name: string, path: number[][]) =>
  ({ ...line(name, path.map(p => p[0]), path.map(p => p[1])), mode: 'lines+markers' as const });

export function kernelDensity(data: number[], x: number[]) {
  const average = mean(data);
  const sd = Math.sqrt(sum(data.map(v => (v - average) ** 2)) / (data.length - 1));
  const bandwidth = Math.max(.005, 1.06 * sd * data.length ** (-.2));
  return { bandwidth, y: x.map(t => mean(data.map(v => normalPDF(t, v, bandwidth ** 2)))) };
}

export function overrelaxedEM(data: number[], initial: GaussianInitial, factor = 2, iterations = 60) {
  let model = initial, fit = gaussianEM(data, initial.means.length, 0, model), eta = 1;
  const history = [fit.likelihood], etas: number[] = [];
  let extrapolationsAccepted = 0, fallbacks = 0;
  for (let i = 0; i < iterations; i++) {
    const ordinary = gaussianEM(data, model.means.length, 1, model);
    let selected = ordinary;
    if (eta > 1) {
      const candidate = {
        means: model.means.map((v, k) => v + eta * (ordinary.means[k] - v)),
        variances: model.variances.map((v, k) =>
          Math.exp(Math.log(v) + eta * (Math.log(ordinary.variances[k]) - Math.log(v)))),
        weights: normalize(model.weights.map((v, k) =>
          Math.exp(Math.log(v) + eta * (Math.log(ordinary.weights[k]) - Math.log(v))))),
      };
      if (candidate.variances.every(v => Number.isFinite(v) && v >= 1e-6) &&
        candidate.means.every(Number.isFinite) && candidate.weights.every(v => v > 0)) {
        const trial = gaussianEM(data, model.means.length, 0, candidate);
        // Stronger safeguard than the original: beat the regular M-step, not merely the old iterate.
        if (trial.likelihood >= ordinary.likelihood) {
          selected = { ...ordinary, ...trial }; extrapolationsAccepted++;
        } else { eta = 1; fallbacks++; }
      } else { eta = 1; fallbacks++; }
    }
    etas.push(eta); eta = Math.min(16, eta * factor);
    model = { means: selected.means, variances: selected.variances, weights: selected.weights };
    fit = gaussianEM(data, model.means.length, 0, model); history.push(fit.likelihood);
  }
  return { ...fit, history, etas, extrapolationsAccepted, fallbacks };
}

export function huberFit(design: number[][], y: number[], delta = .2) {
  let w = linearFit(design, y).coefficients;
  const loss = (t: number[]) => mean(y.map((v, i) => {
    const r = Math.abs(dot(design[i], t) - v);
    return r <= delta ? .5 * r * r : delta * (r - .5 * delta);
  }));
  const history = [loss(w)];
  for (let iteration = 0; iteration < 80; iteration++) {
    const weights = y.map((v, i) => Math.min(1, delta / Math.max(1e-14, Math.abs(dot(design[i], w) - v))));
    const a = zeros(w.length, w.length), b = Array<number>(w.length).fill(0);
    design.forEach((row, i) => row.forEach((v, j) => {
      b[j] += weights[i] * v * y[i];
      row.forEach((u, k) => { a[j][k] += weights[i] * v * u; });
    }));
    const next = solve(a, b), distance = norm(next.map((v, i) => v - w[i]));
    w = next; history.push(loss(w));
    if (distance < 1e-10) break;
  }
  const score = w.map((_, j) => mean(y.map((v, i) =>
    design[i][j] * Math.max(-delta, Math.min(delta, dot(design[i], w) - v)))));
  return { w, history, loss: loss(w), score };
}

export function logisticFit(design: number[][], y: number[], lambda = 0) {
  const objective: Objective = w => {
    const g = Array<number>(w.length).fill(0), h = zeros(w.length, w.length);
    let value = 0;
    design.forEach((row, i) => {
      const z = dot(row, w), p = sigmoid(z);
      value += (Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z))) - y[i] * z) / y.length;
      row.forEach((v, j) => {
        g[j] += (p - y[i]) * v / y.length;
        row.forEach((u, k) => { h[j][k] += p * (1 - p) * v * u / y.length; });
      });
    });
    w.forEach((v, j) => {
      if (j === 0) return;
      value += .5 * lambda * v * v; g[j] += lambda * v; h[j][j] += lambda;
    });
    return { value, g, h };
  };
  return newtonMinimize(objective, Array<number>(design[0].length).fill(0), 40);
}

export const naturalFisher = [[9 + 1 / 9, 1], [1, 1 / 9]];
export function naturalGradientPaths(steps = 180) {
  const paths = { steepest: [[1, -1]], natural: [[1, -1]] };
  const kl = (theta: number[]) => .5 * dot(theta, naturalFisher.map(row => dot(row, theta)));
  const losses = { steepest: [kl(paths.steepest[0])], natural: [kl(paths.natural[0])] };
  for (let i = 0; i < steps; i++) for (const method of ['steepest', 'natural'] as const) {
    const theta = paths[method].at(-1)!, gradient = naturalFisher.map(row => dot(row, theta));
    const direction = method === 'natural' ? solve(naturalFisher, gradient) : gradient;
    const epsilon = method === 'natural' ? .2 : 1 / 45;
    const next = theta.map((v, j) => v - epsilon * direction[j]);
    paths[method].push(next); losses[method].push(kl(next));
  }
  return { paths, losses };
}

export function peaksEnergy(row: number, column: number) {
  const x = -3 + column / 8, y = -3 + row / 8;
  return (3 * (1 - x) ** 2 * Math.exp(-x * x - (y + 1) ** 2) -
    10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-x * x - y * y) -
    Math.exp(-((x + 1) ** 2) - y * y) / 3) / 10;
}
export const metropolisAccept = (delta: number, temperature: number, uniform: number) =>
  Math.log(Math.max(Number.MIN_VALUE, uniform)) < Math.min(0, -delta / temperature);

export function annealPeaks(seed: number, steps = 1600) {
  const rng = seededRandom(seed), path = [[34, 24]], energies = [peaksEnergy(34, 24)];
  const temperatures: number[] = [], bestEnergies = [energies[0]], accepted: boolean[] = [];
  let uphillAccepted = 0, rejected = 0, best = [...path[0]];
  const decisions: { delta: number; temperature: number; uniform: number; valid: boolean }[] = [];
  for (let i = 0; i < steps; i++) {
    const current = path.at(-1)!, proposal = current.map(v => v + Math.round(2 * normal(rng)));
    const temperature = .995 ** i;
    const valid = proposal.every(v => v >= 0 && v <= 48);
    const energy = valid ? peaksEnergy(proposal[0], proposal[1]) : energies.at(-1)!;
    const delta = energy - energies.at(-1)!, uniform = rng();
    const accept = valid && metropolisAccept(delta, temperature, uniform);
    decisions.push({ delta, temperature, uniform, valid }); accepted.push(accept);
    if (accept && delta > 0) uphillAccepted++;
    if (!accept) rejected++;
    path.push(accept ? proposal : [...current]); energies.push(accept ? energy : energies.at(-1)!);
    temperatures.push(temperature);
    if (energies.at(-1)! < bestEnergies.at(-1)!) best = [...path.at(-1)!];
    bestEnergies.push(Math.min(bestEnergies.at(-1)!, energies.at(-1)!));
  }
  return { path, energies, temperatures, bestEnergies, best, accepted, decisions, uphillAccepted, rejected };
}

const logBeta = (a: number, b: number) => logGamma(a) + logGamma(b) - logGamma(a + b);
export function betaBinomialMass(n: number, a: number, b: number) {
  return range(n + 1).map(k => Math.exp(logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) +
    logBeta(k + a, n - k + b) - logBeta(a, b)));
}

/** Shortest contiguous 95%-mass interval on midpoint quadrature cells, not a normal approximation. */
export function betaGridHDI(a: number, b: number, cells = 512, mass = .95) {
  const logs = range(cells).map(i => {
    const x = (i + .5) / cells;
    return (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x);
  });
  const shift = Math.max(...logs), probabilities = normalize(logs.map(v => Math.exp(v - shift)));
  let right = 0, total = 0, bestWidth = cells + 1, leftBest = 0, rightBest = cells, captured = 1;
  for (let left = 0; left < cells; left++) {
    while (right < cells && total < mass - 1e-14) total += probabilities[right++];
    if (total >= mass - 1e-14 && (right - left < bestWidth ||
      right - left === bestWidth && total > captured + 1e-14)) {
      bestWidth = right - left; leftBest = left; rightBest = right; captured = total;
    }
    total -= probabilities[left];
  }
  return { lo: leftBest / cells, hi: rightBest / cells, width: bestWidth / cells, mass: captured };
}

export function discreteInformation(x: number[], y: number[]) {
  const xs = [...new Set(x)], ys = [...new Set(y)], joint = zeros(xs.length, ys.length);
  x.forEach((v, i) => { joint[xs.indexOf(v)][ys.indexOf(y[i])]++; });
  const p = joint.map(row => row.map(v => v / x.length));
  const px = p.map(sum), py = ys.map((_, j) => sum(p.map(row => row[j])));
  const entropy = (q: number[]) => -sum(q.filter(v => v > 0).map(v => v * Math.log(v)));
  const hx = entropy(px), hy = entropy(py), hxy = entropy(p.flat());
  let mi = 0;
  p.forEach((row, i) => row.forEach((v, j) => { if (v > 0) mi += v * Math.log(v / (px[i] * py[j])); }));
  return { mi, hx, hy, hxy, joint: p };
}

/** MATLAB-compatible column-major patch order and vectorization; valid cross-correlation. */
export function crossCorrelationMatrices(image: number[][], filter: number[][]) {
  const height = image.length - filter.length + 1, width = image[0].length - filter[0].length + 1;
  const patches: number[][] = [], direct = zeros(height, width), matrix = zeros(height, width);
  const f = filter[0].flatMap((_, c) => filter.map(row => row[c]));
  for (let c = 0; c < width; c++) for (let r = 0; r < height; r++) {
    const patch: number[] = [];
    for (let j = 0; j < filter[0].length; j++) for (let i = 0; i < filter.length; i++) patch.push(image[r + i][c + j]);
    patches.push(patch); matrix[r][c] = dot(patch, f);
    // Independently use row-major loops, avoiding reuse of the patch matrix.
    for (let i = 0; i < filter.length; i++) for (let j = 0; j < filter[0].length; j++)
      direct[r][c] += image[r + i][c + j] * filter[i][j];
  }
  return { patches, direct, matrix, filterVector: f };
}

export function groupProx(x: number[], lambda: number, groupSize: number) {
  const answer = [...x];
  for (let start = 0; start < x.length; start += groupSize) {
    const magnitude = norm(x.slice(start, start + groupSize));
    const scale = magnitude === 0 ? 0 : Math.max(0, 1 - lambda / magnitude);
    for (let j = start; j < Math.min(x.length, start + groupSize); j++) answer[j] *= scale;
  }
  return answer;
}

/** ISTA with L=1 for row-orthonormal measurement matrices. */
export function sparseReconstruct(a: number[][], y: number[], lambda: number, groupSize: number, iterations = 450) {
  const p = a[0].length;
  const gradient = (w: number[]) => {
    const residual = a.map((row, i) => dot(row, w) - y[i]), g = Array<number>(p).fill(0);
    a.forEach((row, i) => { for (let j = 0; j < p; j++) g[j] += row[j] * residual[i]; });
    return g;
  };
  const prox = (w: number[]) => groupSize === 1 ? w.map(v => softThreshold(v, lambda)) : groupProx(w, lambda, groupSize);
  const objective = (w: number[]) => {
    let penalty = 0;
    for (let start = 0; start < p; start += groupSize) penalty += norm(w.slice(start, start + groupSize));
    return .5 * sum(a.map((row, i) => (dot(row, w) - y[i]) ** 2)) + lambda * penalty;
  };
  let w = Array<number>(p).fill(0);
  const history = [objective(w)];
  for (let i = 0; i < iterations; i++) {
    const g = gradient(w), next = prox(w.map((v, j) => v - g[j]));
    const distance = norm(next.map((v, j) => v - w[j]));
    w = next; history.push(objective(w));
    if (distance < 1e-8) break;
  }
  const g = gradient(w), next = prox(w.map((v, j) => v - g[j]));
  return { w, history, proximalResidual: norm(w.map((v, j) => v - next[j])) };
}

function runARS(seed: number): ExperimentResult {
  const rng = seededRandom(seed), p = range(14).map(() => .1 + .8 * rng()), logP = sum(p.map(Math.log));
  const captureLog = (x: number) => 14 * sum(range(10).map(j => Math.log(x + j))) -
    14 * logGamma(10) + x * logP - 2 * Math.log(x + 10);
  const captureDerivative = (x: number) => 14 * sum(range(10).map(j => 1 / (x + j))) + logP - 2 / (x + 10);
  const full = adaptiveRejection(x => -x * x, x => -2 * x, [-2, 0, 2], [-Infinity, Infinity], 1000, rng);
  const half = adaptiveRejection(x => -x * x / 3, x => -2 * x / 3, [-4, -1, 0], [-Infinity, 0], 1000, rng);
  const capture = adaptiveRejection(captureLog, captureDerivative, [1, 4, 20], [1, Infinity], 1000, rng);
  const captureGrid = grid(1, 40, 1001), logValues = captureGrid.map(captureLog), shift = Math.max(...logValues);
  const ordinates = logValues.map(v => Math.exp(v - shift)), step = captureGrid[1] - captureGrid[0];
  const integral = step * (sum(ordinates) - .5 * (ordinates[0] + ordinates.at(-1)!));
  const captureMean = step * sum(ordinates.map((v, i) => v * captureGrid[i] *
    (i === 0 || i === ordinates.length - 1 ? .5 : 1))) / integral;
  const plots: VisualPlot[] = [
    { title: 'Gaussian: true adaptive rejection samples', fit: full, lo: -3, hi: 3,
      density: (x: number) => Math.exp(-x * x) / Math.sqrt(Math.PI) },
    { title: 'Negative half-Gaussian (σ parameter = 3)', fit: half, lo: -6, hi: 0,
      density: (x: number) => 2 * Math.exp(-x * x / 3) / Math.sqrt(3 * Math.PI) },
    { title: 'Capture–recapture conditional: ARS vs quadrature', fit: capture, lo: 1, hi: 25,
      density: (x: number) => Math.exp(captureLog(x) - shift) / integral },
  ].map(spec => {
    const h = histogram(spec.fit.samples, spec.lo, spec.hi), x = grid(spec.lo, spec.hi);
    return curvePlot(spec.title, 'x', 'Probability density', [
      { name: 'ARS sample density', type: 'bar', x: h.x, y: h.y }, line('Normalized target', x, x.map(spec.density)),
    ]);
  });
  let runningTotal = 0;
  const runningMean = full.samples.map((v, i) => { runningTotal += v; return runningTotal / (i + 1); });
  plots.push(curvePlot('Gaussian Monte Carlo convergence', 'Accepted sample count', 'Running mean',
    [line('ARS running mean', range(1000).map(i => i + 1), runningMean), line('Analytic mean = 0', [1, 1000], [0, 0])]));
  const m = mean(full.samples), second = mean(full.samples.map(v => v * v));
  const halfMean = mean(half.samples), expectedHalf = -Math.sqrt(3 / Math.PI);
  const envelopeError = Math.max(full.maxEnvelopeViolation, half.maxEnvelopeViolation, capture.maxEnvelopeViolation);
  return { plots, metrics: { samples_per_target: 1000, gaussian_mean: m, gaussian_second_moment: second,
    half_mean: halfMean, capture_mean: mean(capture.samples), capture_quadrature_mean: captureMean,
    acceptance_rate: 3000 / (full.proposals + half.proposals + capture.proposals),
    squeeze_acceptances: full.squeezed + half.squeezed + capture.squeezed,
    capture_tail_density_at_40: Math.exp(captureLog(40) - shift) / integral },
  checks: [
    check('Tangent envelope dominates all evaluated targets', envelopeError < 1e-10, envelopeError, '< 1e-10'),
    check('Gaussian mean agrees with E[X]=0 within six standard errors', Math.abs(m) < 6 * Math.sqrt(.5 / 1000), m, '|mean| < 6√(0.5/1000)'),
    check('Gaussian second moment agrees with E[X²]=1/2', Math.abs(second - .5) < 6 * Math.sqrt(.5 / 1000), second, '|moment − 0.5| < 6√(0.5/1000)'),
    check('Half-Gaussian mean agrees with −√(3/π)', Math.abs(halfMean - expectedHalf) < .18, halfMean - expectedHalf, '|error| < 0.18'),
    check('Half-Gaussian samples obey the truncated support', Math.max(...half.samples) <= 0, Math.max(...half.samples), 'maximum ≤ 0'),
    check('Capture–recapture sample mean agrees with independent quadrature', Math.abs(mean(capture.samples) - captureMean) < .8,
      mean(capture.samples) - captureMean, '|error| < 0.8'),
  ] };
}

function runRosen2d(): ExperimentResult {
  const n = newtonMinimize(rosenbrock, [-1, 2]), b = bfgsRosenbrock([-1, 2]);
  return { plots: [
    rosenLandscape([pathTrace('Damped Newton', n.path), pathTrace('BFGS', b.path), scatter('Known minimum', [1], [1])]),
    curvePlot('Actual optimization convergence', 'Accepted update', 'log10(objective + 1e-20)', [
      line('Damped Newton', range(n.values.length), n.values.map(v => Math.log10(v + 1e-20))),
      line('BFGS', range(b.values.length), b.values.map(v => Math.log10(v + 1e-20))),
    ]),
  ], metrics: { newton_objective: n.value, bfgs_objective: b.value, newton_gradient_norm: norm(n.g),
    bfgs_gradient_norm: norm(b.g), newton_updates: n.path.length - 1, bfgs_updates: b.path.length - 1 },
  checks: [
    check('Newton reaches the analytic global minimum (1,1)', norm(n.x.map(v => v - 1)) < 1e-5, norm(n.x.map(v => v - 1)), 'distance < 1e-5'),
    check('BFGS reaches the analytic global minimum (1,1)', b.value < 1e-10, b.value, 'objective < 1e-10'),
    check('Armijo Newton descent is monotone', monotone(n.values), Math.max(...n.values.slice(1).map((v, i) => v - n.values[i])), 'largest increase ≤ 1e-8'),
    check('BFGS first-order optimality', norm(b.g) < 1e-5, norm(b.g), 'gradient norm < 1e-5'),
  ] };
}

function runRosenHigh(seed: number): ExperimentResult {
  const rng = seededRandom(seed), start = range(12).map(() => 2 * rng() - 1);
  const analytic = newtonMinimize(rosenbrock, start, 130);
  const numerical = newtonMinimize(x => ({ ...rosenbrock(x), h: finiteDifferenceHessian(x) }), start, 130);
  const hessian = rosenbrock(start).h, numericHessian = finiteDifferenceHessian(start);
  const derivativeError = maxAbs(hessian.flatMap((row, i) => row.map((v, j) => v - numericHessian[i][j])));
  const candidate = rosenbrock([-.96205109, .93573953, .88071386, .77787813, .60509438]);
  const candidateEigen = Math.min(...symmetricEigen(candidate.h).values);
  const outsideBand = maxAbs(hessian.flatMap((row, i) => row.filter((_, j) => Math.abs(i - j) > 1)));
  return { plots: [
    matrixPlot('Extended Rosenbrock analytic Hessian (tridiagonal)', hessian),
    curvePlot('Analytic vs central-difference Hessian Newton', 'Accepted update', 'log10(objective + 1e-20)', [
      line('Analytic Hessian', range(analytic.values.length), analytic.values.map(v => Math.log10(v + 1e-20))),
      line('Finite-difference Hessian', range(numerical.values.length), numerical.values.map(v => Math.log10(v + 1e-20))),
    ]),
    curvePlot('Final coordinates (a stationary point need not be global)', 'Coordinate', 'Value', [
      line('Analytic-Hessian result', range(12), analytic.x), line('Known global minimizer', range(12), range(12).map(() => 1)),
    ]),
  ], metrics: { dimension: 12, analytic_objective: analytic.value, numerical_objective: numerical.value,
    gradient_norm: norm(analytic.g), hessian_max_error: derivativeError,
    analytic_objective_calls: analytic.evaluations, numeric_extra_gradient_calls: 24 * numerical.evaluations,
    supplied_5d_candidate_objective: candidate.value, supplied_5d_candidate_gradient: norm(candidate.g),
    supplied_5d_candidate_min_hessian_eigenvalue: candidateEigen,
    stationary_point_class: analytic.value < 1e-8 ? 'Global minimum reached' : 'Nonglobal stationary point; no global-success claim' },
  checks: [
    check('Analytic Hessian agrees with central gradient differences', derivativeError < 1e-5, derivativeError, 'max error < 1e-5'),
    check('Extended Hessian has zero entries outside its tridiagonal band', outsideBand === 0, outsideBand, '= 0'),
    check('Both actual optimizers reach a first-order stationary point', Math.max(norm(analytic.g), norm(numerical.g)) < 1e-5,
      Math.max(norm(analytic.g), norm(numerical.g)), 'both gradient norms < 1e-5'),
    check('Analytic and numerical Hessian fits agree in objective', Math.abs(analytic.value - numerical.value) < 1e-7,
      Math.abs(analytic.value - numerical.value), 'absolute difference < 1e-7'),
    check('Published 5D candidate is locally stationary with positive Hessian', norm(candidate.g) < 1e-4 && candidateEigen > 0,
      norm(candidate.g), 'gradient norm < 1e-4 and minimum Hessian eigenvalue > 0'),
  ], notes: ['The supplied negative-first-coordinate candidate is tested, not assumed to be the global minimum. Work counts are deterministic; no fabricated timing comparison.'] };
}

function runConstrained(): ExperimentResult {
  const fit = constrainedRosenbrock(), theta = grid(0, 2 * Math.PI);
  const maxRadius = Math.max(...fit.path.map(p => dot(p, p)));
  return { plots: [
    rosenLandscape([line('Unit-disk boundary', theta.map(Math.cos), theta.map(Math.sin)),
      pathTrace('Feasible interior-point path', fit.path), scatter('Constrained solution', [fit.x[0]], [fit.x[1]])], true),
    curvePlot('Barrier continuation', 'Barrier stage', 'Rosenbrock objective',
      [line('Objective at each central-path solve', range(fit.barrierValues.length), fit.barrierValues)]),
  ], metrics: { x: fit.x[0], y: fit.x[1], objective: fit.value, squared_radius: dot(fit.x, fit.x),
    multiplier: fit.lambda, kkt_stationarity: fit.stationarity, complementarity: fit.lambda * fit.slack },
  checks: [
    check('Every interior-point iterate satisfies x²+y² < 1', maxRadius < 1, maxRadius, 'maximum squared radius < 1'),
    check('Constrained KKT stationarity ∥∇f+2λx∥', fit.stationarity < 1e-5, fit.stationarity, '< 1e-5'),
    check('Complementarity λ(1−x²−y²) tends to zero', fit.lambda * fit.slack < 1e-6, fit.lambda * fit.slack, '< 1e-6'),
    check('KKT dual feasibility and boundary activity', fit.lambda > 0 && fit.slack < 1e-4, fit.slack, 'λ > 0 and slack < 1e-4'),
    check('Constrained objective agrees with the independent boundary optimum fixture', Math.abs(fit.value - .0456748087) < 2e-6,
      fit.value, '|f − 0.0456748087| < 2e-6'),
  ] };
}

function runMC(seed: number): ExperimentResult {
  const rng = seededRandom(seed), samples = range(1000).map(() => 1.5 + .25 * normal(rng));
  const x = grid(0, 3, 241), plots: VisualPlot[] = [];
  let minHistogramMass = 1;
  for (const n of [10, 100, 1000]) {
    const subset = samples.slice(0, n), h = histogram(subset, 0, 3, 40), kde = kernelDensity(subset, x);
    minHistogramMass = Math.min(minHistogramMass, sum(h.y) * h.width);
    plots.push(curvePlot(`Monte Carlo density approximation: n=${n}`, 'x', 'Density', [
      { name: 'Normalized histogram', type: 'bar', x: h.x, y: h.y },
      line('Gaussian KDE (Silverman bandwidth)', x, kde.y), line('N(1.5, 0.25²) truth', x, x.map(t => normalPDF(t, 1.5, .25 ** 2))),
    ]));
  }
  const ns = [10, 30, 100, 300, 1000], squaredErrors = ns.map(() => 0), trials = 100;
  for (let trial = 0; trial < trials; trial++) {
    let total = 0;
    for (let n = 1; n <= 1000; n++) {
      total += .25 * normal(rng);
      const j = ns.indexOf(n); if (j >= 0) squaredErrors[j] += (total / n) ** 2;
    }
  }
  const rmse = squaredErrors.map(v => Math.sqrt(v / trials)), oracle = ns.map(n => .25 / Math.sqrt(n));
  const ratios = rmse.map((v, i) => v / oracle[i]);
  plots.push(curvePlot('Mean-estimator accuracy across 100 independent trials', 'Sample size', 'RMSE', [
    line('Measured RMSE (actual samples)', ns, rmse), line('Analytic σ/√n', ns, oracle),
  ]));
  return { plots, metrics: { sample_mean: mean(samples), mean_error: mean(samples) - 1.5, trials,
    smallest_rmse_ratio: Math.min(...ratios), largest_rmse_ratio: Math.max(...ratios) },
  checks: [
    check('Normalized histogram area equals one', Math.abs(minHistogramMass - 1) < 1e-12, minHistogramMass, '|area − 1| < 1e-12'),
    check('Empirical mean-estimator RMSE matches σ/√n', ratios.every(v => v > .65 && v < 1.4),
      Math.max(...ratios.map(v => Math.abs(v - 1))), 'all RMSE/oracle ratios in (0.65, 1.4)'),
    check('Full sample mean is within six theoretical standard errors', Math.abs(mean(samples) - 1.5) < 6 * .25 / Math.sqrt(1000),
      mean(samples) - 1.5, '|error| < 6σ/√1000'),
  ], notes: ['Individual sample errors need not decrease monotonically; the accuracy plot uses repeated-trial RMSE instead.'] };
}

function runEM(seed: number): ExperimentResult {
  const rng = seededRandom(seed), data = range(400).map(() => (rng() < .45 ? -1.2 : 1.2) + .75 * normal(rng));
  const initial = { means: [-.5, .5], variances: [2, 2], weights: [.5, .5] };
  const ordinary = gaussianEM(data, 2, 60, initial);
  const or = overrelaxedEM(data, initial, 2, 60), orFast = overrelaxedEM(data, initial, 1.5, 60);
  const histories = [ordinary.history.map(v => v.likelihood), or.history, orFast.history];
  const x = grid(-4, 4), h = histogram(data, -4, 4);
  const responsibilityError = Math.max(...or.responsibilities.map(row => Math.abs(sum(row) - 1)));
  const lastGain = or.history.at(-1)! - or.history.at(-2)!;
  return { plots: [
    curvePlot('Actual observed-data log likelihood from identical initialization', 'M-step', 'Log likelihood', [
      line('EM', range(histories[0].length), histories[0]), line('Adaptive OR, growth ×2', range(or.history.length), or.history),
      line('Adaptive OR, growth ×1.5', range(orFast.history.length), orFast.history),
    ]),
    curvePlot('Fitted 1D mixture (bounded synthetic workload)', 'x', 'Density', [
      { name: 'Sample density', type: 'bar', x: h.x, y: h.y },
      line('EM mixture', x, x.map(t => sum(ordinary.means.map((mu, k) => ordinary.weights[k] * normalPDF(t, mu, ordinary.variances[k]))))),
      line('Over-relaxed mixture', x, x.map(t => sum(or.means.map((mu, k) => or.weights[k] * normalPDF(t, mu, or.variances[k]))))),
    ]),
    curvePlot('Real adaptive extrapolation factors', 'Update', 'η used', [line('OR ×2', range(or.etas.length), or.etas)]),
  ], metrics: { observations: data.length, components: 2, em_log_likelihood: ordinary.likelihood, or_log_likelihood: or.likelihood,
    accepted_extrapolations: or.extrapolationsAccepted, fallback_steps: or.fallbacks,
    final_average_likelihood_gain: lastGain / data.length, responsibility_max_sum_error: responsibilityError },
  checks: [
    check('EM and safeguarded OR have monotone likelihoods', histories.every(h => monotone(h, 1)),
      Math.min(...histories.flatMap(h => h.slice(1).map((v, i) => v - h[i]))), 'smallest gain ≥ −1e-8'),
    check('Responsibilities sum to one', responsibilityError < 1e-12, responsibilityError, '< 1e-12'),
    check('Mixture weights normalized and variances positive', Math.abs(sum(or.weights) - 1) < 1e-12 && or.variances.every(v => v > 0),
      Math.abs(sum(or.weights) - 1), 'weight sum error < 1e-12; all variances > 0'),
    check('Over-relaxed EM reaches likelihood convergence', Math.abs(lastGain) / data.length < 1e-5, lastGain / data.length, '|last gain|/N < 1e-5'),
    check('At least one extrapolated update is actually accepted', or.extrapolationsAccepted > 0, or.extrapolationsAccepted, '> 0'),
  ] };
}

function runApplications(seed: number): ExperimentResult {
  const rng = seededRandom(seed), xs = grid(-2, 2, 100), design = xs.map(v => [1, v]);
  const ys = xs.map((v, i) => 1 + 2 * v + .12 * normal(rng) + (i % 12 === 0 ? 6 * Math.sign(v) : 0));
  const least = linearFit(design, ys), robust = huberFit(design, ys);
  const classification = range(180).map(() => [1, normal(rng), normal(rng)]);
  const labels = classification.map(row => rng() < sigmoid(dot(row, [-.2, 1.5, -1])) ? 1 : 0);
  const mle = logisticFit(classification, labels), map = logisticFit(classification, labels, .25);
  const cx = grid(-3, 3), lossAt = (w: number[]) => mean(ys.map((v, i) => {
    const r = Math.abs(dot(design[i], w) - v); return r <= .2 ? .5 * r * r : .2 * (r - .1);
  }));
  const traces = [0, 1].map(label => {
    const rows = classification.filter((_, i) => labels[i] === label);
    return scatter(`Class ${label}`, rows.map(r => r[1]), rows.map(r => r[2]));
  });
  return { plots: [
    curvePlot('Robust regression with explicitly synthetic outliers', 'Predictor', 'Response', [
      scatter('Observed responses', xs, ys), line('Known signal', xs, xs.map(v => 1 + 2 * v)),
      line('Ordinary least squares', xs, design.map(row => dot(row, least.coefficients))),
      line('Huber IRLS, δ=0.2', xs, design.map(row => dot(row, robust.w))),
    ]),
    curvePlot('Logistic MLE and L2-MAP (bias unpenalized)', 'x₁', 'x₂', [...traces,
      line('MLE decision boundary', cx, cx.map(v => -(mle.x[0] + mle.x[1] * v) / mle.x[2])),
      line('MAP decision boundary', cx, cx.map(v => -(map.x[0] + map.x[1] * v) / map.x[2])),
    ]),
    curvePlot('Optimized logistic objectives (different regularization)', 'Newton update', 'Average penalized loss', [
      line('MLE objective', range(mle.values.length), mle.values), line('MAP objective', range(map.values.length), map.values),
    ]),
  ], metrics: { least_squares_slope: least.coefficients[1], huber_slope: robust.w[1], huber_score_norm: norm(robust.score),
    mle_slope_norm: norm(mle.x.slice(1)), map_slope_norm: norm(map.x.slice(1)),
    mle_gradient_norm: norm(mle.g), map_gradient_norm: norm(map.g) },
  checks: [
    check('Huber optimum has near-zero clipped-residual score', norm(robust.score) < 1e-7, norm(robust.score), '< 1e-7'),
    check('Huber fit improves the actual Huber objective over least squares', robust.loss <= lossAt(least.coefficients) + 1e-10,
      robust.loss - lossAt(least.coefficients), 'loss difference ≤ 1e-10'),
    check('Both logistic fits satisfy their score equations', Math.max(norm(mle.g), norm(map.g)) < 1e-6,
      Math.max(norm(mle.g), norm(map.g)), 'gradient norms < 1e-6'),
    check('L2 regularization shrinks the slope norm', norm(map.x.slice(1)) < norm(mle.x.slice(1)),
      norm(map.x.slice(1)) / norm(mle.x.slice(1)), 'MAP/MLE slope norm ratio < 1'),
  ] };
}

function runNatural(): ExperimentResult {
  const { paths, losses } = naturalGradientPaths(), eigen = symmetricEigen(naturalFisher);
  const whiten = (x: number[]) => eigen.vectors.map((v, i) => dot(v, x) * Math.sqrt(eigen.values[i]));
  const whitened = paths.natural.map(whiten);
  const expected = paths.natural.map((p, i) => norm(p.map((v, j) => v - (j === 0 ? 1 : -1) * .8 ** i)));
  const transformError = Math.max(...whitened.map((p, i) => Math.abs(.5 * dot(p, p) - losses.natural[i])));
  return { plots: [
    curvePlot('Same Gaussian mean model: two actual descent paths', 'θ₁', 'θ₂',
      [pathTrace('Euclidean steepest descent', paths.steepest), pathTrace('Fisher natural gradient', paths.natural)]),
    curvePlot('KL convergence (not negative log-likelihood with an arbitrary offset)', 'Update', 'log10 KL', [
      line('Steepest descent', range(losses.steepest.length), losses.steepest.map(v => Math.log10(Math.max(1e-300, v)))),
      line('Natural gradient', range(losses.natural.length), losses.natural.map(v => Math.log10(Math.max(1e-300, v)))),
    ]),
    curvePlot('Natural descent in whitened Fisher coordinates', 'φ₁', 'φ₂', [
      pathTrace('φ = G½ θ in eigenbasis', whitened), scatter('Gaussian KL minimum', [0], [0]),
    ]),
  ], metrics: { fisher_condition_number: eigen.values[0] / eigen.values[1], natural_final_kl: losses.natural.at(-1)!,
    steepest_final_kl: losses.steepest.at(-1)!, natural_step: .2, steepest_step: 1 / 45 },
  checks: [
    check('Natural update equals the analytic θₜ=0.8ᵗθ₀', Math.max(...expected) < 1e-12, Math.max(...expected), 'maximum path error < 1e-12'),
    check('Fisher whitening makes KL equal ½∥φ∥²', transformError < 1e-12, transformError, 'maximum identity error < 1e-12'),
    check('Both actual KL histories decrease', monotone(losses.natural) && monotone(losses.steepest),
      losses.natural.at(-1)!, 'both histories nonincreasing to tolerance 1e-8'),
    check('Natural gradient converges on the bounded iteration budget', losses.natural.at(-1)! < 1e-25,
      losses.natural.at(-1)!, 'final KL < 1e-25'),
  ], notes: ['For centered data the sample-dependent cross terms cancel exactly. The expected KL and exact model Fisher equal the original formulas without storing 1,000,000 iterates.'] };
}

function runAnnealing(seed: number): ExperimentResult {
  const fit = annealPeaks(seed), landscape = range(49).map(r => range(49).map(c => peaksEnergy(r, c)));
  const global = Math.min(...landscape.flat()), n = fit.temperatures.length;
  const tail = fit.energies.slice(-100), tailMean = mean(tail), tailSD = Math.sqrt(mean(tail.map(v => (v - tailMean) ** 2)));
  const stateError = Math.max(...fit.path.map((p, i) => Math.abs(peaksEnergy(p[0], p[1]) - fit.energies[i])));
  const decisionErrors = fit.decisions.filter((d, i) =>
    fit.accepted[i] !== (d.valid && metropolisAccept(d.delta, d.temperature, d.uniform))).length;
  const surface = matrixPlot('Original scaled peaks energy: 49×49 grid', landscape);
  surface.xLabel = 'Column (zero-based)'; surface.yLabel = 'Negative row (zero-based)';
  surface.traces.push(line('Accepted chain (rejections repeat position)', fit.path.map(p => p[1]), fit.path.map(p => -p[0])),
    scatter('Best visited state', [fit.best[1]], [-fit.best[0]]));
  return { plots: [surface,
    curvePlot('Annealing energy and exhaustive-search reference', 'Proposal', 'Energy', [
      line('Current accepted-state energy', range(fit.energies.length), fit.energies),
      line('Best visited energy', range(fit.bestEnergies.length), fit.bestEnergies),
      line('Exhaustive grid minimum', [0, n], [global, global]),
    ]),
    curvePlot('Geometric cooling schedule', 'Proposal', 'Temperature', [line('Tₜ = 0.995ᵗ', range(n), fit.temperatures)]),
  ], metrics: { proposals: n, acceptance_rate: sum(fit.accepted.map(Number)) / n, uphill_accepted: fit.uphillAccepted,
    rejected: fit.rejected, best_energy: fit.bestEnergies.at(-1)!, exhaustive_grid_minimum: global,
    best_grid_gap: fit.bestEnergies.at(-1)! - global, last_100_energy_sd: tailSD,
    convergence_diagnostic: tailSD < .001 ? 'Last 100 energies stable; not a proof of global convergence' : 'Last 100 energies not yet stable' },
  checks: [
    check('Every acceptance decision obeys the Metropolis rule', decisionErrors === 0, decisionErrors, 'decision mismatches = 0'),
    check('Recorded chain energies equal the actual objective', stateError < 1e-14, stateError, 'maximum error < 1e-14'),
    check('Best-so-far energy is monotone and bounded by exhaustive search', monotone(fit.bestEnergies) && fit.bestEnergies.at(-1)! >= global - 1e-12,
      fit.bestEnergies.at(-1)! - global, 'gap ≥ −1e-12 and best history nonincreasing'),
    check('The run includes accepted uphill moves and rejected proposals', fit.uphillAccepted > 0 && fit.rejected > 0,
      fit.uphillAccepted, 'uphill acceptances > 0 and rejections > 0'),
    check('Cooling ends at the prescribed positive temperature', Math.abs(fit.temperatures.at(-1)! - .995 ** (n - 1)) < 1e-15,
      fit.temperatures.at(-1)!, '= 0.995^(proposals − 1)'),
  ], notes: ['Best visited and final chain state are distinct. Stability is reported quantitatively, not asserted to prove a global optimum.'] };
}

function runPower(): ExperimentResult {
  const ns = range(20).map(i => 1 + i * 5), width = new Map<number, number[]>();
  let minimumMass = 1;
  for (const n of ns) width.set(n, range(n + 1).map(k => {
    const interval = betaGridHDI(k + 1, n - k + 1);
    minimumMass = Math.min(minimumMass, interval.mass); return interval.width;
  }));
  let massError = 0;
  const power = (priorMean: number, priorN: number, maxWidth: number) => ns.map(n => {
    const pmf = betaBinomialMass(n, priorMean * priorN, (1 - priorMean) * priorN);
    massError = Math.max(massError, Math.abs(sum(pmf) - 1));
    return sum(pmf.map((v, k) => width.get(n)![k] <= maxWidth ? v : 0));
  });
  const curves = [.6, .7, .8].map(m => power(m, 10, .2));
  const tighter = power(.7, 10, .15), looser = power(.7, 10, .25);
  const uniformError = Math.abs(betaGridHDI(1, 1).width - .95);
  const endpointError = Math.abs(betaGridHDI(1, 10).width - (1 - .05 ** .1));
  return { plots: [
    curvePlot('Bayesian assurance: P(95% posterior HDI width ≤ 0.2)', 'Future binary trials N', 'Predictive probability', [
      ...curves.map((y, i) => line(`Design prior mean ${[.6, .7, .8][i]}, strength 10`, ns, y)),
    ]),
    curvePlot('Precision target sensitivity (design prior mean 0.7)', 'Future binary trials N', 'Predictive probability', [
      line('Width ≤ 0.15', ns, tighter), line('Width ≤ 0.20', ns, curves[1]), line('Width ≤ 0.25', ns, looser),
    ]),
    curvePlot('Design prior strength sensitivity (mean 0.7, width ≤ 0.2)', 'Future binary trials N', 'Predictive probability',
      [5, 10, 100].map(s => line(`Beta prior strength ${s}`, ns, power(.7, s, .2)))),
  ], metrics: { hdi_mass: .95, quadrature_cells: 512, interval_width_resolution: 1 / 512,
    predictive_mass_max_error: massError, endpoint_beta_hdi_error: endpointError, minimum_interval_quadrature_mass: minimumMass },
  checks: [
    check('Beta-binomial predictive distributions sum to one', massError < 1e-10, massError, 'maximum normalization error < 1e-10'),
    check('Computed HDIs contain at least 95% quadrature mass', minimumMass >= .95 - 1e-12, minimumMass, 'mass ≥ 0.95 − 1e-12'),
    check('Uniform Beta(1,1) HDI has analytic width 0.95', uniformError < 2 / 512, uniformError, 'error < 2 grid cells'),
    check('Monotone Beta(1,10) HDI matches its analytic boundary interval', endpointError < 2 / 512, endpointError, 'error < 2 grid cells'),
    check('Tighter interval goal cannot have higher predictive success probability',
      tighter.every((v, i) => v <= curves[1][i] + 1e-12 && curves[1][i] <= looser[i] + 1e-12),
      Math.max(...tighter.map((v, i) => v - looser[i])), 'tight power ≤ medium power ≤ loose power'),
  ], notes: ['Design prior drives the beta-binomial future-data distribution; analysis posterior uses Beta(1,1), exactly as in the original active width-target example.'] };
}

function runMI(seed: number): ExperimentResult {
  const rng = seededRandom(seed), data = range(512).map(() => {
    const topic = rng() < .5 ? 1 : 0, independent = rng() < .5 ? 1 : 0;
    return [topic, topic, rng() < .1 ? 1 - topic : topic, independent, 0, topic ^ independent];
  });
  const columns = range(6).map(j => data.map(row => row[j])), mi = zeros(6, 6), alternate = zeros(6, 6);
  const entropies = columns.map(col => discreteInformation(col, col).hx);
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    mi[i][j] = mi[j][i] = discreteInformation(columns[i], columns[j]).mi;
    // Independent binary indicator-count route: n11 and the two marginal counts.
    const oneI = sum(columns[i]), oneJ = sum(columns[j]), both = dot(columns[i], columns[j]), n = data.length;
    const counts = [n - oneI - oneJ + both, oneJ - both, oneI - both, both];
    const hJoint = -sum(counts.filter(v => v > 0).map(v => v / n * Math.log(v / n)));
    alternate[i][j] = alternate[j][i] = entropies[i] + entropies[j] - hJoint;
  }
  const error = maxAbs(mi.flatMap((row, i) => row.map((v, j) => v - alternate[i][j])));
  const boundError = Math.max(...mi.flatMap((row, i) => row.map((v, j) => v - Math.min(entropies[i], entropies[j]))));
  return { plots: [
    matrixPlot('Pairwise mutual information (nats; diagonal zero by PMTK convention)', mi),
    curvePlot('Synthetic binary feature entropies', 'Feature', 'Entropy (nats)', [{
      name: 'H(feature)', type: 'bar', x: ['topic', 'copy', 'noisy copy', 'independent', 'constant', 'XOR'], y: entropies,
    }]),
    curvePlot('Two independently computed MI routes', 'Ordered pair index (including zero diagonal)', 'MI (nats)', [
      line('Joint-table KL', range(36), mi.flat()), line('H(X)+H(Y)−H(X,Y), indicator counts', range(36), alternate.flat()),
    ]),
  ], metrics: { observations: 512, features: 6, route_max_difference: error, copy_mutual_information: mi[0][1],
    noisy_copy_mutual_information: mi[0][2], independent_empirical_mi: mi[0][3], constant_entropy: entropies[4] },
  checks: [
    check('Joint-table KL agrees with independently counted entropy identity', error < 1e-12, error, '< 1e-12'),
    check('MI is nonnegative and no larger than marginal entropy', Math.min(...mi.flat()) >= -1e-12 && boundError < 1e-12,
      boundError, '0 ≤ I(X;Y) ≤ min(H(X),H(Y)) to 1e-12'),
    check('Identical features have I(X;X)=H(X)', Math.abs(mi[0][1] - entropies[0]) < 1e-12,
      Math.abs(mi[0][1] - entropies[0]), 'error < 1e-12'),
    check('Constant feature has zero entropy and zero mutual information', entropies[4] === 0 && maxAbs(mi[4]) < 1e-12,
      maxAbs(mi[4]), 'constant-row MI = 0'),
    check('Noisy channel loses information relative to a perfect copy', mi[0][2] < mi[0][1] && mi[0][2] > mi[0][3],
      mi[0][2], 'independent empirical MI < noisy-copy MI < copy MI'),
  ], notes: ['Empirical MI for independent finite samples is not forced to zero. No 20 Newsgroups data or timing claims are used.'] };
}

function runConvolution(seed: number): ExperimentResult {
  const rng = seededRandom(seed), image = range(8).map(() => range(10).map(() => normal(rng)));
  const filter = range(3).map(() => range(3).map(() => normal(rng))), fit = crossCorrelationMatrices(image, filter);
  const residual = fit.direct.flatMap((row, i) => row.map((v, j) => v - fit.matrix[i][j]));
  const demonstration = range(4).map(r => range(5).map(c => r + 4 * c + 1));
  const example = crossCorrelationMatrices(demonstration, range(3).map(() => [1, 1, 1]));
  return { plots: [
    matrixPlot('Seeded 8×10 input image', image), matrixPlot('Unflipped 3×3 correlation filter', filter),
    matrixPlot('im2row: 48 overlapping patches × 9 entries', fit.patches), matrixPlot('Valid cross-correlation: 6×8', fit.matrix),
    curvePlot('Direct sliding filter vs patch-matrix multiplication', 'Column-major output index', 'Response', [
      line('Direct spatial correlation', range(48), range(8).flatMap(c => range(6).map(r => fit.direct[r][c]))),
      line('im2row × vec(filter)', range(48), range(8).flatMap(c => range(6).map(r => fit.matrix[r][c]))),
    ]),
  ], metrics: { output_height: 6, output_width: 8, patch_rows: fit.patches.length, patch_columns: fit.patches[0].length,
    maximum_absolute_residual: maxAbs(residual), example_first_patch_sum: sum(example.patches[0]) },
  checks: [
    check('Spatial cross-correlation equals matrix multiplication', maxAbs(residual) < 1e-12, maxAbs(residual), 'max absolute residual < 1e-12'),
    check('Valid-correlation output shape is (8−3+1)×(10−3+1)', fit.matrix.length === 6 && fit.matrix[0].length === 8,
      fit.matrix.flat().length, '= 48 output values'),
    check('MATLAB reshape/im2col fixture preserves column-major patch order',
      example.patches[0].every((v, i) => v === [1, 2, 3, 5, 6, 7, 9, 10, 11][i]),
      sum(example.patches[0]), 'first patch [1,2,3,5,6,7,9,10,11], sum 54'),
  ], notes: ['Despite the original filename, the active operation is valid cross-correlation: the filter is not flipped.'] };
}

function runGroup(seed: number): ExperimentResult {
  const rng = seededRandom(seed), p = 80, n = 56, size = 8, a: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = range(p).map(() => normal(rng));
    for (let pass = 0; pass < 2; pass++) for (const previous of a) {
      const projection = dot(row, previous);
      row.forEach((v, j) => { row[j] = v - projection * previous[j]; });
    }
    const magnitude = norm(row); a.push(row.map(v => v / magnitude));
  }
  const orthogonalityError = Math.max(...a.flatMap((row, i) => a.map((other, j) => Math.abs(dot(row, other) - (i === j ? 1 : 0)))));
  const plots: VisualPlot[] = [], metrics: ExperimentResult['metrics'] = { coefficients: p, observations: n, group_size: size };
  const checks: ExperimentResult['checks'] = [
    check('Measurement rows are orthonormal, certifying ISTA step 1/L=1', orthogonalityError < 1e-12, orthogonalityError, 'max |AAᵀ−I| < 1e-12'),
  ];
  for (const kind of ['Gaussian', 'Uniform'] as const) {
    const truth = range(p).map(j => [2, 7].includes(Math.floor(j / size)) ? kind === 'Uniform' ? 1 : normal(rng) : 0);
    const y = a.map(row => dot(row, truth) + .02 * normal(rng)), aty = range(p).map(j => sum(a.map((row, i) => row[j] * y[i])));
    const lambda = .12 * Math.max(...range(p / size).map(g => norm(aty.slice(g * size, (g + 1) * size))));
    const group = sparseReconstruct(a, y, lambda, size), lasso = sparseReconstruct(a, y, lambda, 1);
    const groupNorms = (x: number[]) => range(p / size).map(g => norm(x.slice(g * size, (g + 1) * size)));
    plots.push(curvePlot(`${kind} group-sparse signal: actual penalized reconstructions`, 'Coefficient', 'Amplitude', [
      line('Synthetic truth', range(p), truth), line('Block L2 group lasso', range(p), group.w), line('Scalar L1 lasso', range(p), lasso.w),
    ]), curvePlot(`${kind} signal: block selection`, 'Group index', 'L2 norm', [
      { name: 'Truth', type: 'bar', x: range(p / size), y: groupNorms(truth) },
      { name: 'Group lasso', type: 'bar', x: range(p / size), y: groupNorms(group.w) },
    ]), curvePlot(`${kind} signal: true composite objectives`, 'ISTA update', 'Penalized objective', [
      line('Block L2 objective', range(group.history.length), group.history),
      line('Scalar L1 objective (different penalty)', range(lasso.history.length), lasso.history),
    ]));
    metrics[`${kind}_group_mse`] = mean(group.w.map((v, j) => (v - truth[j]) ** 2));
    metrics[`${kind}_lasso_mse`] = mean(lasso.w.map((v, j) => (v - truth[j]) ** 2));
    metrics[`${kind}_group_proximal_residual`] = group.proximalResidual;
    metrics[`${kind}_active_groups`] = groupNorms(group.w).filter(v => v > 1e-6).length;
    checks.push(
      check(`${kind}: group composite objective decreases under actual proximal steps`, monotone(group.history),
        group.history.at(-1)! - group.history[0], 'all increases ≤ 1e-8'),
      check(`${kind}: group-lasso first-order proximal fixed-point residual`, group.proximalResidual < 1e-5,
        group.proximalResidual, '∥w−prox(w−∇loss)∥ < 1e-5'),
      check(`${kind}: scalar-lasso first-order proximal fixed-point residual`, lasso.proximalResidual < 1e-5,
        lasso.proximalResidual, '∥w−soft(w−∇loss)∥ < 1e-5'),
      check(`${kind}: reconstructed signal improves on the zero estimator`,
        sum(group.w.map((v, j) => (v - truth[j]) ** 2)) < dot(truth, truth),
        metrics[`${kind}_group_mse`] as number, 'MSE below zero-estimator MSE'),
    );
  }
  return { plots, metrics, checks };
}

function reproduction(id: string, title: string, method: string, description: string, differences: string[],
  run: (seed: number) => ExperimentResult): Reproduction {
  return { id, title, source: `demos/${id}.m`, method, description,
    differences: ['Independent TypeScript conceptual reproduction; not execution or validation of the original MATLAB/Octave program.', ...differences], run };
}

export const numericalReproductions: Reproduction[] = [
  reproduction('arsDemo', 'Adaptive rejection sampling', 'Tangent-envelope ARS with chord squeeze and exact exponential proposals',
    'Samples the original Gaussian, negative half-Gaussian, and capture–recapture conditional targets; compares empirical densities with their mathematical targets.',
    ['1,000 rather than 20,000 accepted samples per target; analytic log derivatives replace finite-difference/secant hull construction.',
      'Capture probabilities are seeded synthetic values in [0.1,0.9]; normalization/mean use finite [1,40] quadrature with the tail density reported.',
      'Support knots are capped at 96; a frozen valid envelope still uses exact rejection correction.'], runARS),
  reproduction('demoRosen2d', 'Rosenbrock optimization paths', 'Damped analytic Newton and inverse-Hessian BFGS with Armijo line search',
    'Shows curved-valley optimization trajectories and measured objective convergence to (1,1).',
    ['MATLAB fminunc variants are replaced by explicit Newton and BFGS algorithms, both from the original start (−1,2).',
      'A colored scatter grid replaces contours; no numeric-derivative fminunc comparison or toolbox timing claim.'], runRosen2d),
  reproduction('demoRosenHighDim', 'Extended Rosenbrock derivatives and local minima', 'Analytic vs central-difference Hessian damped Newton',
    'Exposes the tridiagonal Hessian, compares two real derivative strategies and checks the original five-dimensional stationary candidate.',
    ['12 rather than 20 dimensions, at most 130 updates; two Hessian strategies instead of all four fminunc options.',
      'No sparse solver benchmark or wall-clock claims; objective/gradient evaluation counts are reported. Nonglobal stationary points are labeled.'], runRosenHigh),
  reproduction('demoRosenConstrained', 'Rosenbrock inside a unit disk', 'Feasible logarithmic-barrier continuation with Newton solves',
    'Solves the original nonlinear disk-constrained objective and reports primal feasibility, dual feasibility, stationarity and complementarity.',
    ['Explicit log-barrier Newton replaces fmincon and its three derivative-configuration comparisons.',
      'The infeasible original start is moved radially to radius 0.8 before barrier continuation; all displayed iterates are feasible.'], runConstrained),
  reproduction('mcAccuracyDemo', 'Monte Carlo density and estimator accuracy', 'Gaussian sampling, normalized histograms, Gaussian KDE and repeated-trial RMSE',
    'Compares finite-sample density approximations and independently measured mean-estimation RMSE with the analytic σ/√N law.',
    ['Uses the original active Gaussian N(1.5,0.25²), not the inactive Gamma branch; sample sizes 10,100,1000.',
      'Explicit Gaussian KDE with Silverman bandwidth replaces ksdensity; fixed histogram coordinates correct the original unlocated bar call.',
      'Adds 100 actual independent Monte Carlo trials for accuracy diagnostics.'], runMC),
  reproduction('mixGaussOverRelaxedEmDemo', 'Safeguarded over-relaxed Gaussian EM', 'EM plus adaptive extrapolation in means, log variances and log weights',
    'Compares actual likelihood trajectories from identical initialization, accepted extrapolation factors and fitted mixture densities.',
    ['400 synthetic scalar observations and two components replace 5,000 observations in 15 dimensions and K=5/10.',
      'Maximum-likelihood fitting with variance floor 1e-6, no original default priors; growth factors 1.5 and 2, capped η=16.',
      'Safeguard requires an extrapolation to beat the ordinary M-step; original only requires improvement over the previous iterate. No timing claims.'], runEM),
  reproduction('minFunc_applications', 'Optimization applications: robustness and regularization', 'Huber IRLS and logistic Newton MLE/L2-MAP',
    'Demonstrates two original optimization applications using actual fitted objectives, robust residual scores and regularization-induced slope shrinkage.',
    ['Bounded subset only: Huber regression and binary logistic MLE/MAP; minFunc is replaced by IRLS and explicit Newton.',
      'Synthetic 100-case regression adds an intercept and controlled outliers; 180-case logistic data is nonseparable so a finite MLE exists.',
      'Omits probit, kernel/multinomial models, neural networks, smooth SVM/SVR and graphical-model examples. Penalties use average loss and leave the bias unpenalized.'], runApplications),
  reproduction('natgradDemo', 'Natural gradient as Fisher whitening', 'Exact Gaussian KL, Euclidean descent and inverse-Fisher natural descent',
    'Uses the original sf=3 Gaussian mean parameterization and exact Fisher matrix to illustrate conditioning, whitening and KL convergence.',
    ['180 rather than one million updates; exact centered-data expected KL replaces storing simulated observations.',
      'Path and whitened-coordinate plots replace the original quiver fields; step sizes retain the original 1/45 and 0.2.'], runNatural),
  reproduction('simulatedAnnealingDemo2d', 'Simulated annealing on scaled peaks', 'Symmetric rounded-Gaussian grid Metropolis proposals and geometric cooling',
    'Runs an accepted/rejected Markov chain on the original 49×49 peaks energy and compares best visited energy with exhaustive search.',
    ['1,600 proposals rather than 1,000, integer grid states with zero-based row/column coordinates instead of continuous states rounded on evaluation.',
      'Retains scale 1/10, proposal standard deviation 2 and cooling factor 0.995; out-of-grid proposals reject.',
      'Scatter energy map and accepted-state path replace 3D surfaces/histograms. Tracks best state separately and reports stability without claiming guaranteed global convergence.'], runAnnealing),
  reproduction('powerCurvesDemo', 'Bayesian precision assurance curves', 'Beta-binomial predictive enumeration and grid-based shortest posterior intervals',
    'Computes the predictive probability that a uniform-analysis-prior 95% Beta posterior HDI meets a precision target.',
    ['512-cell midpoint quadrature and shortest contiguous interval replace betainv/fminbnd HDIs; widths have resolution 1/512 and are explicitly approximate.',
      'Retains N=1,6,…,96 and original design means/strengths/widths, but shows selected combinations instead of every figure.',
      'Only the active width goal is implemented; no null-exclusion branch or frequentist-power relabeling.'], runPower),
  reproduction('miDemo', 'Pairwise entropy and mutual information', 'Joint contingency-table KL versus independently counted entropy identities',
    'Compares two actual discrete mutual-information computations and shows copy, noisy-channel, independent, constant and XOR features.',
    ['512 seeded synthetic binary documents × six features replace unavailable 20news_w100; no corpus or performance equivalence claim.',
      'Compares joint-table and binary indicator-count algorithms, not three original discrete/mixed implementations; no continuous quantization branch.',
      'Uses natural logarithms and the original zero diagonal convention.'], runMI),
  reproduction('convMatMultDemo', 'Cross-correlation as matrix multiplication', 'Direct valid 2D cross-correlation versus column-major im2row GEMV',
    'Unrolls overlapping image patches and verifies that multiplying by the vectorized filter exactly matches independent spatial correlation.',
    ['Retains original 8×10 Gaussian input and 3×3 Gaussian filter sizes plus the reshape(1:20,4,5) fixture.',
      'Square-scatter matrix visuals replace console LaTeX printing; unfinished/inactive multi-channel filter-bank code is omitted.'], runConvolution),
  reproduction('groupLassoDemo', 'Group-sparse signal reconstruction', 'Block-L2 proximal ISTA versus scalar-L1 ISTA on row-orthonormal measurements',
    'Reconstructs genuinely Gaussian and uniform group-sparse signals with actual block shrinkage, objective histories and proximal optimality residuals.',
    ['80 coefficients, 56 observations, 10 groups of size 8 and two active groups replace 4096/1024/64 groups/eight active groups.',
      'Explicit monotone ISTA (≤450 updates) replaces SpaRSA; λ=0.12 max block norm(Aᵀy), shared across the two different penalties.',
      'No block-L∞ fit or post-selection debiasing; plots are explicitly the penalized, biased estimates. Gaussian noise retains standard deviation 0.02.'], runGroup),
];
