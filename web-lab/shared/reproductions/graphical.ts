import type { ExperimentResult, Reproduction, VisualPlot, VisualTrace } from './types.js';
import {
  dot, line, matrixPlot, mean, normalize, range, seededRandom, softThreshold,
  solve, sum, symmetricEigen, transpose, zeros,
} from './math.js';
import { hmmForwardBackward, logSumExp } from '../numerics.js';

// Independent, bounded educational implementations. No MATLAB execution, files,
// downloads, external pages, proprietary images, or claims of recovered datasets.
const bar = (name: string, x: number[] | string[], y: number[]): VisualTrace => ({ name, type: 'bar', x, y });
const curve = (title: string, traces: VisualTrace[], xLabel?: string, yLabel?: string): VisualPlot =>
  ({ title, traces, xLabel, yLabel });
const maxDiff = (a: number[], b: number[]) => Math.max(0, ...a.map((v, i) => Math.abs(v - b[i])));
const mse = (a: number[], b: number[]) => mean(a.map((v, i) => (v - b[i]) ** 2));
const monotone = (values: number[]) => values.every((v, i) => i === 0 || v <= values[i - 1] + 1e-10);
const check = (name: string, passed: boolean, detail?: string) => ({ name, passed, detail });
const spins = (n: number) => range(2 ** n).map(mask => range(n).map(i => (mask >> i & 1) * 2 - 1));
const sampleIndex = (probabilities: number[], random: () => number) => {
  let u = random();
  for (let i = 0; i < probabilities.length - 1; i++) {
    u -= probabilities[i];
    if (u < 0) return i;
  }
  return probabilities.length - 1;
};
const definition = (
  id: string, title: string, method: string, description: string, differences: string[],
  run: (seed: number) => ExperimentResult,
): Reproduction => ({ id, title, source: `demos/${id}.m`, method, description, differences, run });

/** Binary spin chain: p(s|x) proportional to exp(sum h_i*s_i + sum J_i*s_i*s_(i+1)). */
export function inferSpinChain(fields: number[], couplings: number[]) {
  const n = fields.length, states = [-1, 1];
  if (!n || couplings.length !== n - 1) throw new RangeError('Invalid spin chain');
  const alpha = [states.map(s => fields[0] * s)];
  const delta = [alpha[0].slice()], pointers: number[][] = [states.map(() => 0)];
  for (let t = 1; t < n; t++) {
    alpha.push(states.map(s => fields[t] * s + logSumExp(states.map((r, j) =>
      alpha[t - 1][j] + couplings[t - 1] * r * s))));
    const back: number[] = [];
    delta.push(states.map(s => {
      const options = states.map((r, j) => delta[t - 1][j] + couplings[t - 1] * r * s);
      const best = Math.max(...options);
      back.push(options.indexOf(best));
      return best + fields[t] * s;
    }));
    pointers.push(back);
  }
  const logZ = logSumExp(alpha[n - 1]), beta = zeros(n, 2);
  for (let t = n - 2; t >= 0; t--) for (let j = 0; j < 2; j++) {
    beta[t][j] = logSumExp(states.map((s, k) =>
      couplings[t] * states[j] * s + fields[t + 1] * s + beta[t + 1][k]));
  }
  const marginals = alpha.map((row, t) => row.map((v, j) => Math.exp(v + beta[t][j] - logZ)));
  const correlations = range(n - 1).map(t => sum(states.flatMap((s, j) => states.map((r, k) =>
    s * r * Math.exp(alpha[t][j] + couplings[t] * s * r + fields[t + 1] * r + beta[t + 1][k] - logZ)))));
  const path = Array<number>(n).fill(0);
  let state = delta[n - 1].indexOf(Math.max(...delta[n - 1]));
  for (let t = n - 1; t >= 0; t--) {
    path[t] = states[state];
    if (t) state = pointers[t][state];
  }
  return { logZ, marginals, correlations, path, mapScore: Math.max(...delta[n - 1]) };
}

export interface ChainCase { season: number; labels: number[] }
/** Exact conditional NLL, with tied node/edge seasonal features and L2 weights. */
export function chainObjective(weights: number[], data: ChainCase[], variant: number, lambda = .02) {
  let value = 0;
  const gradient = weights.map(() => 0);
  for (const { season, labels } of data) {
    const nf = [1, variant >= 1 ? season : 0], ef = [1, variant >= 2 ? season : 0];
    const field = dot(weights.slice(0, 2), nf), coupling = dot(weights.slice(2), ef);
    const inference = inferSpinChain(labels.map(() => field), range(labels.length - 1).map(() => coupling));
    const observedNode = sum(labels), observedEdge = sum(labels.slice(1).map((s, i) => s * labels[i]));
    value += inference.logZ - field * observedNode - coupling * observedEdge;
    const nodeError = sum(inference.marginals.map(p => p[1] - p[0])) - observedNode;
    const edgeError = sum(inference.correlations) - observedEdge;
    for (let j = 0; j < 2; j++) {
      gradient[j] += nf[j] * nodeError / data.length;
      gradient[2 + j] += ef[j] * edgeError / data.length;
    }
  }
  value /= data.length;
  for (let j = 0; j < weights.length; j++) {
    value += lambda * weights[j] ** 2 / 2;
    gradient[j] += lambda * weights[j];
  }
  return { value, gradient };
}

function fitChain(data: ChainCase[], variant: number) {
  let weights = [0, 0, 0, 0], current = chainObjective(weights, data, variant);
  const history = [current.value];
  for (let iteration = 0; iteration < 65; iteration++) {
    let step = .2;
    for (let backtrack = 0; backtrack < 18; backtrack++) {
      const candidate = weights.map((v, j) => v - step * current.gradient[j]);
      const next = chainObjective(candidate, data, variant);
      if (next.value <= current.value - 1e-4 * step * dot(current.gradient, current.gradient)) {
        weights = candidate;
        current = next;
        break;
      }
      step /= 2;
    }
    history.push(current.value);
  }
  return { weights, history, gradient: current.gradient };
}

/** Symmetric Ising pseudolikelihood; one scalar parameter per undirected edge. */
export function isingPseudoObjective(weights: number[], data: number[][], edges: number[][], nodeL2 = .01) {
  const n = data[0].length, gradient = weights.map(() => 0);
  let value = 0;
  for (const labels of data) {
    const fields = weights.slice(0, n), residuals = Array<number>(n).fill(0);
    edges.forEach(([a, b], e) => {
      fields[a] += weights[n + e] * labels[b];
      fields[b] += weights[n + e] * labels[a];
    });
    for (let i = 0; i < n; i++) {
      const field = fields[i], magnitude = Math.abs(field);
      residuals[i] = (Math.tanh(field) - labels[i]) / (data.length * n);
      value += (magnitude + Math.log1p(Math.exp(-2 * magnitude)) - labels[i] * field) / (data.length * n);
      gradient[i] += residuals[i];
    }
    edges.forEach(([a, b], e) => {
      gradient[n + e] += residuals[a] * labels[b] + residuals[b] * labels[a];
    });
  }
  for (let i = 0; i < n; i++) {
    value += nodeL2 * weights[i] ** 2 / 2;
    gradient[i] += nodeL2 * weights[i];
  }
  return { value, gradient };
}

function fitStructure(data: number[][], edges: number[][], penalty: number) {
  const n = data[0].length;
  let weights = Array<number>(n + edges.length).fill(0);
  const objective = (w: number[]) => isingPseudoObjective(w, data, edges).value + penalty * sum(w.slice(n).map(Math.abs));
  const history = [objective(weights)];
  for (let t = 0; t < 180; t++) {
    const { gradient } = isingPseudoObjective(weights, data, edges);
    let step = 1;
    for (let backtrack = 0; backtrack < 16; backtrack++) {
      const next = weights.map((w, j) => j < n ? w - step * gradient[j] : softThreshold(w - step * gradient[j], step * penalty));
      const value = objective(next);
      if (value <= history[history.length - 1] + 1e-13) {
        weights = next;
        break;
      }
      step /= 2;
    }
    history.push(objective(weights));
  }
  const { gradient } = isingPseudoObjective(weights, data, edges);
  const kkt = Math.max(...gradient.map((g, j) => j < n ? Math.abs(g) :
    weights[j] === 0 ? Math.max(0, Math.abs(g) - penalty) : Math.abs(g + penalty * Math.sign(weights[j]))));
  return { weights, history, kkt };
}

interface ScoredPath { path: number[]; score: number }
const pathOrder = (a: ScoredPath, b: ScoredPath) => b.score - a.score || a.path.join('').localeCompare(b.path.join(''));
/** Keep K prefixes per destination state: exact k-best Viterbi, not marginal argmax. */
export function kBestHmm(initial: number[], transition: number[][], emission: number[][], observations: number[], k: number) {
  let lists: ScoredPath[][] = initial.map((p, state) =>
    [{ path: [state], score: Math.log(p) + Math.log(emission[state][observations[0]]) }]);
  for (const observed of observations.slice(1)) {
    lists = initial.map((_, dest) => lists.flatMap((list, from) => list.map(prefix => ({
      path: [...prefix.path, dest],
      score: prefix.score + Math.log(transition[from][dest]) + Math.log(emission[dest][observed]),
    }))).sort(pathOrder).slice(0, k));
  }
  return lists.flat().sort(pathOrder).slice(0, k);
}

/** Full disease enumeration, analytically integrating all unobserved findings. */
export function noisyOrPosterior(prior: number[], inhibit: number[][], leakInhibit: number[], evidence: (number | null)[]) {
  const assignments = spins(prior.length).map(row => row.map(s => (s + 1) / 2));
  const absent = assignments.map(state => leakInhibit.map((leak, f) =>
    leak * state.reduce((p, on, d) => p * (on ? inhibit[d][f] : 1), 1)));
  const masses = assignments.map((state, index) => {
    let p = state.reduce((v, on, d) => v * (on ? prior[d] : 1 - prior[d]), 1);
    evidence.forEach((finding, f) => { if (finding !== null) p *= finding ? 1 - absent[index][f] : absent[index][f]; });
    return p;
  });
  const evidenceProbability = sum(masses), probabilities = normalize(masses);
  const posterior = prior.map((_, d) => sum(probabilities.map((p, i) => p * assignments[i][d])));
  const predictive = leakInhibit.map((_, f) => sum(probabilities.map((p, i) => p * (1 - absent[i][f]))));
  return { posterior, evidenceProbability, predictive, probabilities };
}

/** Positive-finding inclusion/exclusion (Quickscore identity), independent of disease enumeration. */
export function noisyOrQuickscore(prior: number[], inhibit: number[][], leak: number[], evidence: (number | null)[]) {
  const positives = range(evidence.length).filter(f => evidence[f] === 1);
  const negatives = range(evidence.length).filter(f => evidence[f] === 0);
  let evidenceProbability = 0;
  const numerator = prior.map(() => 0);
  for (let mask = 0; mask < 2 ** positives.length; mask++) {
    const selected = [...negatives, ...positives.filter((_, j) => mask >> j & 1)];
    const sign = positives.filter((_, j) => mask >> j & 1).length % 2 ? -1 : 1;
    const leakFactor = sign * selected.reduce((p, f) => p * leak[f], 1);
    const active = prior.map((p, d) => p * selected.reduce((v, f) => v * inhibit[d][f], 1));
    const factors = prior.map((p, d) => 1 - p + active[d]);
    evidenceProbability += leakFactor * factors.reduce((a, b) => a * b, 1);
    numerator.forEach((_, d) => {
      numerator[d] += leakFactor * active[d] * factors.reduce((p, v, j) => p * (d === j ? 1 : v), 1);
    });
  }
  return { posterior: numerator.map(p => p / evidenceProbability), evidenceProbability };
}

/** Deliberately small generated grayscale scene, never the proprietary clown image. */
export function syntheticImage(seed: number, rows = 24, cols = 28) {
  const random = seededRandom(seed);
  return range(rows).map(i => range(cols).map(j => {
    const x = j / cols, y = i / rows;
    const disk = (x - .68) ** 2 + (y - .38) ** 2 < .035 ? .38 : 0;
    const box = x > .12 && x < .38 && y > .48 && y < .85 ? .28 : 0;
    return Math.max(0, Math.min(1, .12 + .2 * x + .1 * Math.sin(12 * x + 5 * y) + disk + box + .035 * random()));
  }));
}

/** True convolution (kernel reversal), zero padding, centered odd-sized kernels. */
export function convolveSame(image: number[][], kernel: number[][]) {
  const rows = image.length, cols = image[0].length;
  const hr = Math.floor(kernel.length / 2), hc = Math.floor(kernel[0].length / 2);
  if (!(kernel.length % 2) || !(kernel[0].length % 2)) throw new RangeError('Use centered odd-sized kernels');
  return range(rows).map(i => range(cols).map(j => {
    let total = 0;
    kernel.forEach((row, a) => row.forEach((weight, b) => {
      const y = i + hr - a, x = j + hc - b;
      if (y >= 0 && y < rows && x >= 0 && x < cols) total += weight * image[y][x];
    }));
    return total;
  }));
}

/** Left singular vectors from A*A', reconstructing U_k U_k' A (no fake rank truncation). */
export function imageSvd(image: number[][]) {
  const gram = image.map(a => image.map(b => dot(a, b))), eig = symmetricEigen(gram);
  const components = eig.vectors.map(u => image[0].map((_, j) => sum(image.map((row, i) => u[i] * row[j]))));
  return {
    singularValues: eig.values.map(v => Math.sqrt(Math.max(0, v))),
    vectors: eig.vectors,
    reconstruct: (rank: number) => image.map((row, i) => row.map((_, j) =>
      sum(eig.vectors.slice(0, rank).map((u, k) => u[i] * components[k][j])))),
  };
}

/** Scalar Lloyd quantization: nearest-codeword encoding, conditional-mean updates. */
export function quantizeGray(data: number[], initial: number[], maxIterations = 80) {
  let centers = initial.slice();
  const encode = () => data.map(v => {
    const distances = centers.map(c => (v - c) ** 2);
    return distances.indexOf(Math.min(...distances));
  });
  let assignments = encode();
  const distortion = () => mse(data, assignments.map(k => centers[k]));
  const history = [distortion()];
  for (let t = 0; t < maxIterations; t++) {
    const totals = centers.map(() => 0), counts = centers.map(() => 0);
    data.forEach((v, i) => { totals[assignments[i]] += v; counts[assignments[i]]++; });
    centers = centers.map((c, j) => counts[j] ? totals[j] / counts[j] : c);
    assignments = encode();
    history.push(distortion());
    if (Math.abs(history[history.length - 1] - history[history.length - 2]) < 1e-13) break;
  }
  return { centers, assignments, reconstruction: assignments.map(k => centers[k]), history };
}

export function countNgrams(text: string) {
  // Like ngramMake: lowercase and remove nonalphabet characters; additionally
  // collapse whitespace explicitly, rather than subtracting space-space counts.
  const corpus = text.toLowerCase().replace(/[^a-z ]/g, '').replace(/ +/g, ' ').trim();
  const alphabet = ' abcdefghijklmnopqrstuvwxyz', unigrams = Array<number>(27).fill(0), bigrams = zeros(27, 27);
  [...corpus].forEach((ch, i) => {
    const from = alphabet.indexOf(ch);
    unigrams[from]++;
    if (i + 1 < corpus.length) bigrams[from][alphabet.indexOf(corpus[i + 1])]++;
  });
  return { corpus, alphabet, unigrams, bigrams };
}

function cleanLinks(links: number[][], removeSelf: boolean) {
  return links.map((row, i) => [...new Set(row)].filter(j => !removeSelf || j !== i));
}
/** Moler's normalized resolvent and standard uniform-teleport/dangling power iteration. */
export function pageRank(links: number[][], damping = .85, removeSelf = false) {
  const adjacency = cleanLinks(links, removeSelf), n = links.length;
  const p = zeros(n, n), substochastic = zeros(n, n);
  adjacency.forEach((row, from) => range(n).forEach(to => {
    substochastic[to][from] = row.includes(to) ? 1 / row.length : 0;
    p[to][from] = (1 - damping) / n + damping * (row.length ? substochastic[to][from] : 1 / n);
  }));
  const raw = solve(range(n).map(i => range(n).map(j => (i === j ? 1 : 0) - damping * substochastic[i][j])), range(n).map(() => 1));
  const direct = normalize(raw);
  let power = range(n).map(() => 1 / n);
  const history: number[] = [];
  for (let iteration = 0; iteration < 200; iteration++) {
    const next = p.map(row => dot(row, power));
    const delta = sum(next.map((v, i) => Math.abs(v - power[i])));
    history.push(delta);
    power = next;
    if (delta < 1e-14) break;
  }
  const residual = maxDiff(p.map(row => dot(row, direct)), direct);
  return { adjacency, transition: p, direct, power, history, residual };
}

/** Finite FIFO traversal of an already resident graph. Absolutely no URL fetching. */
export function traverseLocal(links: number[][], root: number, limit: number) {
  const ids = [root], depths = [0], cumulative: number[] = [], edges: number[][] = [];
  const index = new Map<number, number>([[root, 0]]);
  for (let cursor = 0; cursor < ids.length; cursor++) {
    for (const next of new Set(links[ids[cursor]])) {
      if (!index.has(next) && ids.length < limit) {
        index.set(next, ids.length);
        ids.push(next);
        depths.push(depths[cursor] + 1);
      }
      if (index.has(next)) edges.push([cursor, index.get(next)!]);
    }
    cumulative.push(ids.length);
  }
  return { ids, depths, cumulative, edges };
}

function adjacencyImage(links: number[][]) {
  const matrix = zeros(links.length, links.length);
  links.forEach((row, from) => row.forEach(to => { matrix[to][from] = 1; }));
  return matrix;
}

/** Count actual multiplications in two exact inference algorithms on a random chain DGM. */
function chainDgmComparison(prior: number[], transitions: number[][][]) {
  const n = transitions.length + 1, k = prior.length;
  let enumerationOps = 0, eliminationOps = 0;
  const enumerated = zeros(n, k);
  let exhaustiveEvidence = 0;
  for (let code = 0; code < k ** n; code++) {
    let digits = code;
    const state = range(n).map(() => { const s = digits % k; digits = Math.floor(digits / k); return s; });
    let p = prior[state[0]];
    for (let t = 1; t < n; t++) { p *= transitions[t - 1][state[t - 1]][state[t]]; enumerationOps++; }
    p *= state[n - 1] === 0 ? 1 : 0; enumerationOps++;
    exhaustiveEvidence += p;
    state.forEach((s, t) => { enumerated[t][s] += p; });
  }
  const alpha = [prior.slice()], beta = zeros(n, k);
  for (let t = 1; t < n; t++) alpha.push(range(k).map(s => sum(range(k).map(r => {
    eliminationOps++;
    return alpha[t - 1][r] * transitions[t - 1][r][s];
  }))));
  beta[n - 1][0] = 1;
  for (let t = n - 2; t >= 0; t--) for (let r = 0; r < k; r++) {
    beta[t][r] = sum(range(k).map(s => { eliminationOps++; return transitions[t][r][s] * beta[t + 1][s]; }));
  }
  const evidence = alpha[n - 1][0];
  const eliminated = alpha.map((row, t) => row.map((p, s) => { eliminationOps++; return p * beta[t][s] / evidence; }));
  const oracle = enumerated.map(row => row.map(v => v / exhaustiveEvidence));
  return { eliminationOps, enumerationOps, eliminated, oracle, evidence, exhaustiveEvidence };
}

const generatedImageNote = 'Fresh seeded procedural grayscale scene; not recovered clown data and not a downloaded image.';

const chainDemo = definition(
  'crf2ChainTrainDemo', 'Seasonal chain CRF training',
  'Exact log-partition gradients, backtracking gradient descent and max-product decoding',
  'Compare bias-only, seasonal-node, and seasonal-node-and-edge conditional spin-chain models.',
  ['Generated seasonal binary sequences replace rain.mat; 72 cases of length 8.',
    'Tied binary Ising weights with bias and one sinusoidal seasonal feature per node/edge replace untied UGM tables and 12 month indicators.',
    'Exact conditional likelihood with L2=0.02; no UGM/MEX dependency. Samples are drawn from enumerated learned distributions.'],
  seed => {
    const random = seededRandom(seed), configurations = spins(8);
    const distribution = (field: number, coupling: number) => normalize(configurations.map(labels =>
      Math.exp(field * sum(labels) + coupling * sum(labels.slice(1).map((s, i) => s * labels[i])))));
    const data: ChainCase[] = range(72).map(i => {
      const season = Math.cos(2 * Math.PI * Math.floor(i / 6) / 12);
      const p = distribution(-.15 + .85 * season, .45 + .22 * season);
      return { season, labels: configurations[sampleIndex(p, random)].slice() };
    });
    const fits = range(3).map(variant => fitChain(data, variant));
    const predictions = fits.map((fit, variant) => data.map(row => inferSpinChain(
      row.labels.map(() => fit.weights[0] + (variant >= 1 ? row.season * fit.weights[1] : 0)),
      range(7).map(() => fit.weights[2] + (variant >= 2 ? row.season * fit.weights[3] : 0)),
    )));
    const best = fits[2], numericalGradient = best.weights.map((_, j) => {
      const plus = best.weights.slice(), minus = best.weights.slice();
      plus[j] += 1e-5; minus[j] -= 1e-5;
      return (chainObjective(plus, data, 2).value - chainObjective(minus, data, 2).value) / 2e-5;
    });
    const gradientError = maxDiff(numericalGradient, chainObjective(best.weights, data, 2).gradient);
    const seasonalSamples = [11, 7].map(month => {
      const season = Math.cos(2 * Math.PI * month / 12);
      const p = distribution(best.weights[0] + season * best.weights[1], best.weights[2] + season * best.weights[3]);
      return matrixPlot(`Learned samples: synthetic month ${month + 1}`, range(12).map(() => configurations[sampleIndex(p, random)]));
    });
    const accuracy = (variant: number) => mean(data.flatMap((row, i) => row.labels.map((s, j) => Number(s === predictions[variant][i].path[j]))));
    return {
      plots: [
        matrixPlot('Generated binary truth: cases by chain position', data.map(row => row.labels)),
        ...predictions.map((pred, i) => matrixPlot(['Bias-only MAP', 'Seasonal node MAP', 'Seasonal node and edge MAP'][i], pred.map(p => p.path))),
        matrixPlot('Full model P(spin = +1)', predictions[2].map(p => p.marginals.map(row => row[1]))),
        curve('Exact penalized conditional NLL per sequence', fits.map((fit, i) => line(['Bias-only', 'Seasonal node', 'Seasonal node + edge'][i], range(fit.history.length), fit.history)), 'Iteration', 'NLL + L2'),
        curve('Learned tied full-model weights', [bar('Weight', ['node bias', 'node season', 'edge bias', 'edge season'], best.weights)]),
        ...seasonalSamples,
      ],
      metrics: { cases: data.length, positions: 8, initialObjective: fits[2].history[0], finalObjective: best.history.at(-1)!,
        baselineAccuracy: accuracy(0), fullAccuracy: accuracy(2), gradientError, data: 'Generated seasonal sequences, not rain.mat' },
      checks: [
        check('All three exact penalized objectives decrease', fits.every(f => monotone(f.history) && f.history.at(-1)! < f.history[0])),
        check('Analytic gradient matches central differences', gradientError < 1e-7, `max absolute error ${gradientError}`),
        check('Node probabilities normalize', predictions.flat().every(p => p.marginals.every(row => Math.abs(sum(row) - 1) < 1e-10))),
        check('MAP score matches exhaustive 256-state oracle', predictions[2].every((p, i) => {
          const field = best.weights[0] + best.weights[1] * data[i].season;
          const coupling = best.weights[2] + best.weights[3] * data[i].season;
          const scores = configurations.map(s => field * sum(s) + coupling * sum(s.slice(1).map((v, j) => v * s[j])));
          return Math.abs(Math.max(...scores) - p.mapScore) < 1e-10;
        })),
      ],
      notes: ['Training accuracy is descriptive, not held-out performance or a rain-data reproduction.'],
    };
  },
);

const structureDemo = definition(
  'crfFitStructDemo', 'Sparse CRF / Ising structure learning',
  'Symmetric Ising pseudolikelihood and proximal L1 optimization',
  'Fit all candidate undirected edges to synthetic data and visualize genuine regularization-induced sparsity.',
  ['Five binary nodes and 256 generated cases replace the original 10-node UGM simulation.',
    'Feature-free Ising specialization: each edge group has one scalar, so group L1-L2 reduces exactly to absolute-value L1.',
    'Pseudolikelihood, not exact conditional-likelihood training; no claim of reproducing UGM weights or junction-tree timing.'],
  seed => {
    const random = seededRandom(seed), n = 5, configurations = spins(n);
    const edges = range(n).flatMap(a => range(n).filter(b => b > a).map(b => [a, b]));
    const truth = edges.map(([a, b]) => a === 0 && b === 1 ? .9 : a === 1 && b === 2 ? .8 : a === 3 && b === 4 ? -.85 : 0);
    const probabilities = normalize(configurations.map(s => Math.exp(sum(edges.map(([a, b], e) => truth[e] * s[a] * s[b])))));
    const data = range(256).map(() => configurations[sampleIndex(probabilities, random)]);
    const penalties = [0, .02, .08, .45], fits = penalties.map(p => fitStructure(data, edges, p));
    const learned = fits[2], counts = fits.map(f => f.weights.slice(n).filter(w => Math.abs(w) > 1e-5).length);
    const weightsImage = (w: number[]) => {
      const matrix = zeros(n, n);
      edges.forEach(([a, b], e) => { matrix[a][b] = matrix[b][a] = w[e]; });
      return matrix;
    };
    const logits = configurations.map(s => dot(learned.weights.slice(0, n), s) + sum(edges.map(([a, b], e) => learned.weights[n + e] * s[a] * s[b])));
    const exact = logits.map(v => Math.exp(v - logSumExp(logits)));
    return {
      plots: [
        matrixPlot('Generating Ising edge weights', weightsImage(truth)),
        matrixPlot('Learned weights, lambda = 0.08', weightsImage(learned.weights.slice(n))),
        curve('Active undirected edges on regularization path', [bar('Nonzero edges', penalties, counts)], 'L1 penalty', 'Edge count'),
        curve('Penalized pseudolikelihood optimization', fits.map((f, i) => line(`lambda=${penalties[i]}`, range(f.history.length), f.history)), 'Iteration', 'Mean node NLL + penalties'),
        curve('True versus selected edge weights', [bar('Generating', edges.map(e => e.join('-')), truth), bar('Learned lambda=0.08', edges.map(e => e.join('-')), learned.weights.slice(n))]),
        curve('Learned node biases at lambda=0.08', [bar('Node bias', range(n), learned.weights.slice(0, n))]),
        curve('Exact learned-model node marginals', [bar('P(spin=+1)', range(n), range(n).map(j => sum(exact.map((p, i) => configurations[i][j] === 1 ? p : 0))))]),
      ],
      metrics: { nodes: n, candidateEdges: edges.length, selectedEdges: counts[2], highPenaltyEdges: counts[3],
        proximalKktResidual: learned.kkt, finalObjective: learned.history.at(-1)!, exactLogPartition: logSumExp(logits),
        objective: 'Mean node pseudolikelihood + 0.01/2 node L2 + lambda edge L1' },
      checks: [
        check('Proximal objectives are nonincreasing', fits.every(f => monotone(f.history))),
        check('Large L1 penalty eliminates every edge', counts[3] === 0),
        check('Selected fit satisfies approximate KKT conditions', learned.kkt < .015, `max residual ${learned.kkt}`),
        check('Exact learned distribution normalizes', Math.abs(sum(exact) - 1) < 1e-12),
      ],
      notes: ['Exact enumeration is used only for the small learned-model marginal display; training uses genuine pseudolikelihood gradients.'],
    };
  },
);

const hmmDemo = definition(
  'hmmNbestDemo', 'Exact HMM N-best paths',
  'Log-domain k-best Viterbi with exhaustive path oracle and shared forward/backward',
  'Complete the original unfinished N-best educational effect on its published two-state, ten-observation example.',
  ['Uses the original initial, transition, emission probabilities and observation sequence (converted to zero-based symbols).',
    'Independent top-six dynamic program replaces the unfinished max-product helper, which never populated its promised ff output.'],
  _seed => {
    const initial = [.6, .4], transition = [[.6, .4], [.2, .8]], emission = [[.9, .1], [.3, .7]];
    const observations = [0, 0, 1, 1, 1, 1, 0, 0, 1, 1];
    const inference = hmmForwardBackward(initial, transition, emission, observations);
    const best = kBestHmm(initial, transition, emission, observations, 6);
    const exhaustive: ScoredPath[] = range(1024).map(mask => {
      const path = range(10).map(i => mask >> i & 1);
      let probability = initial[path[0]] * emission[path[0]][observations[0]];
      for (let t = 1; t < 10; t++) probability *= transition[path[t - 1]][path[t]] * emission[path[t]][observations[t]];
      return { path, score: Math.log(probability) };
    }).sort(pathOrder);
    const scoreError = maxDiff(best.map(p => p.score), exhaustive.slice(0, 6).map(p => p.score));
    const posteriorMass = sum(best.map(p => Math.exp(p.score - inference.logLikelihood)));
    return {
      plots: [
        matrixPlot('Top six state paths (best at row zero)', best.map(p => p.path)),
        curve('Path posterior probabilities', [bar('P(path | observations)', best.map((_, i) => `Rank ${i + 1}`), best.map(p => Math.exp(p.score - inference.logLikelihood)))]),
        curve('Observations and smoothed state probability', [line('Observed symbol', range(10), observations), line('P(state=1 | all observations)', range(10), inference.marginals.map(p => p[1]))], 'Time', 'Symbol / probability'),
      ],
      metrics: { sequenceProbability: Math.exp(inference.logLikelihood), bestLogJoint: best[0].score, topSixPosteriorMass: posteriorMass,
        scoreOracleError: scoreError, uniquePaths: new Set(best.map(p => p.path.join(''))).size },
      checks: [
        check('Six DP paths match exhaustive top-six scores', scoreError < 1e-12),
        check('Scores descend and paths are distinct', best.every((v, i) => i === 0 || v.score <= best[i - 1].score) && new Set(best.map(p => p.path.join(''))).size === 6),
        check('Forward probability equals exhaustive joint sum', Math.abs(Math.exp(inference.logLikelihood) - sum(exhaustive.map(p => Math.exp(p.score)))) < 1e-14),
        check('Top path equals shared Viterbi solution', best[0].path.every((s, i) => s === inference.viterbi[i])),
        check('Top-six posterior is a strict submass', posteriorMass > 0 && posteriorMass < 1),
      ],
    };
  },
);

const qmrDemo = definition(
  'qmrDemo', 'Exact QMR-like noisy-OR posterior',
  'Disease enumeration versus positive-finding inclusion/exclusion',
  'Infer disease probabilities from positive and negative findings under an actual noisy-OR likelihood.',
  ['Six diseases and eight generated findings replace the original 15/100 network; first and last findings remain unobserved.',
    'Priors 0.03–0.15, absent-leak probabilities 0.85–0.98, and seeded inhibition parameters are synthetic, not clinical or recovered QMR data.',
    'The original noisyOrCpdCreate helper throws "not finished"; the replacement implements the documented inhibition formula directly.',
    'No medical advice or timing claims; the two exact algorithms are compared numerically.'],
  seed => {
    const random = seededRandom(seed), prior = range(6).map(() => .03 + .12 * random());
    const leak = range(8).map(() => .85 + .13 * random());
    const inhibit = range(6).map(() => range(8).map(() => random() < .7 ? .1 + .65 * random() : 1));
    const evidence = [null, 1, 1, 1, 0, 0, 0, null];
    const exact = noisyOrPosterior(prior, inhibit, leak, evidence), quick = noisyOrQuickscore(prior, inhibit, leak, evidence);
    const error = maxDiff(exact.posterior, quick.posterior);
    return {
      plots: [
        curve('Disease prior and posterior', [bar('Prior', range(6), prior), bar('Posterior | findings', range(6), exact.posterior)], 'Disease', 'Probability'),
        matrixPlot('Noisy-OR inhibition (1 means absent link)', inhibit),
        curve('Finding absent-leak probabilities', [bar('Leak inhibited', range(8), leak)]),
        curve('Predictive repeat findings under posterior diseases', [bar('P(new finding = positive | observed findings)', range(8), exact.predictive)], 'Finding (0 and 7 unobserved)', 'Probability'),
        curve('Independent exact posterior comparison', [bar('Enumeration', range(6), exact.posterior), bar('Inclusion/exclusion', range(6), quick.posterior)]),
      ],
      metrics: { diseases: 6, findings: 8, diseaseAssignments: 64, positiveSubsets: 8,
        evidenceProbability: exact.evidenceProbability, algorithmMaxError: error, leakConvention: 'P(finding absent | no diseases)' },
      checks: [
        check('Independent exact posteriors agree', error < 1e-10, `max absolute error ${error}`),
        check('Evidence likelihood agrees', Math.abs(exact.evidenceProbability - quick.evidenceProbability) < 1e-12),
        check('Posterior disease assignment masses normalize', Math.abs(sum(exact.probabilities) - 1) < 1e-12),
        check('Nontrivial conditioning changes disease probabilities', maxDiff(prior, exact.posterior) > 1e-5),
      ],
      notes: ['Predictive bars refer to independent repeated findings, not the already-clamped observations.'],
    };
  },
);

const dgmDemo = definition(
  'randDgmTimingTest', 'Random DGM inference scaling without fake timings',
  'Counted sum-product elimination versus exhaustive enumeration on random chain DAGs',
  'Compare exact conditional marginals and actual multiplication counts as categorical state count grows.',
  ['A random six-node chain DAG with random normalized CPTs replaces the original large random multi-parent DAG.',
    'State counts 2–5 keep enumeration bounded; the final node is observed in state zero.',
    'Operation counts are instrumented in these TypeScript algorithms, not MATLAB/libDAI wall-clock timings, asymptotic guesses, or benchmark speedups.'],
  seed => {
    const random = seededRandom(seed), sizes = [2, 3, 4, 5];
    const results = sizes.map(k => {
      const prior = normalize(range(k).map(() => .1 + random()));
      const transitions = range(5).map(() => range(k).map(() => normalize(range(k).map(() => .1 + random()))));
      return chainDgmComparison(prior, transitions);
    });
    const errors = results.map(r => maxDiff(r.eliminated.flat(), r.oracle.flat()));
    return {
      plots: [
        curve('Instrumented multiplications, not elapsed time', [
          line('Forward/backward elimination', sizes, results.map(r => r.eliminationOps)),
          line('Exhaustive enumeration', sizes, results.map(r => r.enumerationOps)),
        ], 'States per node', 'Multiplications executed'),
        curve('Posterior marginal disagreement', [bar('Maximum absolute error', sizes, errors)], 'States per node', 'Absolute error'),
        matrixPlot('Conditional node marginals at five states', results[3].eliminated),
      ],
      metrics: { nodes: 6, maxStates: 5, maxMarginalError: Math.max(...errors),
        enumerationMultiplications: results[3].enumerationOps, eliminationMultiplications: results[3].eliminationOps,
        benchmark: 'Deterministic counted arithmetic; no host timing measurement' },
      checks: [
        check('All exact conditional marginals agree', errors.every(e => e < 1e-11)),
        check('Evidence likelihoods agree', results.every(r => Math.abs(r.evidence - r.exhaustiveEvidence) < 1e-12)),
        check('Posterior rows normalize', results.every(r => r.eliminated.every(row => Math.abs(sum(row) - 1) < 1e-12))),
        check('Observed final state is clamped', results.every(r => Math.abs(r.eliminated[5][0] - 1) < 1e-12 && sum(r.eliminated[5].slice(1)) === 0)),
        check('Counted elimination uses fewer multiplications', results.every(r => r.eliminationOps < r.enumerationOps)),
      ],
    };
  },
);

const convolutionDemo = definition(
  'imageConvDemo', 'Image convolution and derivatives',
  'Zero-padded Gaussian, centered derivative-of-Gaussian and zero-DC Laplacian-of-Gaussian convolutions',
  'Show the generated image, smoothing, raw and smoothed derivatives, and LoG response.',
  [generatedImageNote, '7x7 sigma=1.25 kernel replaces MATLAB fspecial(15,2); centered odd positive-coordinate derivatives replace the even [-1,1] sign/anchor convention.',
    'Raster-like square scatter plots replace imagesc/surfl; zero padding is explicit.'],
  seed => {
    const image = syntheticImage(seed), sigma = 1.25, coordinates = range(7).map(i => i - 3);
    const one = normalize(coordinates.map(x => Math.exp(-x * x / (2 * sigma ** 2))));
    const gaussian = one.map(y => one.map(x => x * y)), blur = convolveSame(image, gaussian);
    const dx = [[.5, 0, -.5]], dy = transpose(dx);
    // Analytical sampled Gaussian derivatives avoid differentiating an already
    // cropped kernel; all three convolution kernels have odd support.
    const dogX = gaussian.map(row => row.map((v, j) => -coordinates[j] * v / sigma ** 2));
    const dogY = gaussian.map((row, i) => row.map(v => -coordinates[i] * v / sigma ** 2));
    let logKernel = gaussian.map((row, i) => row.map((v, j) =>
      (coordinates[i] ** 2 + coordinates[j] ** 2 - 2 * sigma ** 2) / sigma ** 4 * v));
    const dc = mean(logKernel.flat());
    logKernel = logKernel.map(row => row.map(v => v - dc));
    const separated = convolveSame(convolveSame(image, [one]), one.map(v => [v]));
    const separabilityError = maxDiff(blur.flat(), separated.flat());
    const constantResponse = convolveSame(range(15).map(() => range(15).map(() => 1)), logKernel);
    const interiorDc = Math.max(...constantResponse.slice(3, -3).flatMap(row => row.slice(3, -3)).map(Math.abs));
    return {
      plots: [
        matrixPlot('Generated scene (not clown)', image), matrixPlot('Normalized Gaussian kernel', gaussian),
        matrixPlot('Gaussian-smoothed scene', blur), matrixPlot('Raw centered x derivative', convolveSame(image, dx)),
        matrixPlot('Raw centered y derivative', convolveSame(image, dy)),
        matrixPlot('Smoothed centered x derivative', convolveSame(blur, dx)),
        matrixPlot('Derivative of Gaussian: x', convolveSame(image, dogX)),
        matrixPlot('Derivative of Gaussian: y', convolveSame(image, dogY)),
        matrixPlot('Zero-DC Laplacian of Gaussian', convolveSame(image, logKernel)),
      ],
      metrics: { rows: image.length, columns: image[0].length, gaussianMass: sum(gaussian.flat()), separabilityError,
        logKernelDc: sum(logKernel.flat()), constantInteriorLoG: interiorDc, sigma },
      checks: [
        check('Gaussian kernel mass equals one', Math.abs(sum(gaussian.flat()) - 1) < 1e-12),
        check('Separable and 2D Gaussian convolutions agree', separabilityError < 1e-12),
        check('LoG annihilates constants away from padding', interiorDc < 1e-12),
        check('Gaussian blur reduces squared horizontal differences', mean(blur.flatMap(row => row.slice(1).map((v, j) => (v - row[j]) ** 2))) < mean(image.flatMap(row => row.slice(1).map((v, j) => (v - row[j]) ** 2)))),
      ],
    };
  },
);

const svdDemo = definition(
  'svdImageDemo', 'SVD image rank approximations',
  'Symmetric eigendecomposition of A A-transpose and actual orthogonal rank-k reconstruction',
  'Visualize reconstructed scenes, singular spectra before/after scrambling, and quantitative reconstruction MSE.',
  [generatedImageNote, '24x28 scene and ranks 1,2,5,10,24 replace the large MATLAB clown image and its ranks.',
    'Jacobi symmetricEigen helper supplies left singular vectors; singular values are square roots of nonnegative Gram eigenvalues.'],
  seed => {
    const image = syntheticImage(seed), decomposition = imageSvd(image), ranks = [1, 2, 5, 10, 24];
    const reconstructed = ranks.map(k => decomposition.reconstruct(k)), errors = reconstructed.map(r => mse(image.flat(), r.flat()));
    const flat = image.flat(), shuffled = flat.slice(), random = seededRandom(seed + 1741);
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const scrambled = range(24).map(i => shuffled.slice(i * 28, (i + 1) * 28)), other = imageSvd(scrambled);
    const spectralErrors = ranks.map(k => sum(decomposition.singularValues.slice(k).map(s => s * s)) / flat.length);
    const energyError = Math.abs(sum(decomposition.singularValues.map(s => s * s)) - dot(flat, flat));
    return {
      plots: [
        matrixPlot('Generated original scene', image),
        ...reconstructed.map((r, i) => matrixPlot(`Actual rank-${ranks[i]} reconstruction`, r)),
        matrixPlot('Seeded pixel permutation', scrambled),
        curve('Singular values', [line('Generated scene', range(24).map(i => i + 1), decomposition.singularValues),
          line('Scrambled pixels', range(24).map(i => i + 1), other.singularValues)], 'Singular index', 'Singular value'),
        curve('Reconstruction MSE and spectral tail identity', [line('Pixel MSE', ranks, errors), line('Discarded singular energy / pixels', ranks, spectralErrors)], 'Retained rank', 'MSE'),
      ],
      metrics: { rows: 24, columns: 28, fullRankMse: errors.at(-1)!, rankOneMse: errors[0], gramEnergyError: energyError,
        spectralTailError: maxDiff(errors, spectralErrors) },
      checks: [
        check('Reconstruction error decreases with retained rank', monotone(errors)),
        check('Full row-rank reconstruction recovers pixels', errors.at(-1)! < 1e-18),
        check('MSE equals discarded singular energy per pixel', maxDiff(errors, spectralErrors) < 1e-10),
        check('Squared singular values equal Frobenius energy', energyError < 1e-8),
        check('Scrambling preserves pixel multiset energy', Math.abs(dot(flat, flat) - dot(shuffled, shuffled)) < 1e-9),
      ],
    };
  },
);

const vqDemo = definition(
  'vqDemo', 'Image vector quantization',
  'Lloyd nearest-codeword encoding / mean-codeword updates on grayscale pixel vectors',
  'Compress a generated scene to 2, 4 and 8 intensity codewords and display actual decoded pixels and distortions.',
  [generatedImageNote, 'One-dimensional grayscale pixel vectors specialize the original RGB-capable kmeans.',
    'Deterministic farthest-point palette expansion warm-starts each larger codebook, replacing random kmeans initialization.'],
  seed => {
    const image = syntheticImage(seed), data = image.flat(), sizes = [2, 4, 8];
    let centers = [Math.min(...data), Math.max(...data)];
    const fits = sizes.map(k => {
      while (centers.length < k) {
        const distances = data.map(v => Math.min(...centers.map(c => (v - c) ** 2)));
        centers.push(data[distances.indexOf(Math.max(...distances))]);
      }
      const fit = quantizeGray(data, centers);
      centers = fit.centers.slice();
      return fit;
    });
    const errors = fits.map(f => mse(data, f.reconstruction));
    return {
      plots: [
        matrixPlot('Generated original scene', image),
        ...fits.map((fit, i) => matrixPlot(`Decoded ${sizes[i]}-codeword scene`, range(24).map(row => fit.reconstruction.slice(row * 28, (row + 1) * 28)))),
        curve('Lloyd distortion histories', fits.map((fit, i) => line(`K=${sizes[i]}`, range(fit.history.length), fit.history)), 'Lloyd iteration', 'MSE'),
        curve('Rate-distortion comparison', [line('Pixel distortion', sizes.map(k => Math.log2(k)), errors)], 'Bits per pixel index (palette excluded)', 'MSE'),
        curve('Learned intensity codebooks', fits.map((fit, i) => bar(`K=${sizes[i]}`, range(sizes[i]), fit.centers)), 'Codeword index', 'Intensity'),
      ],
      metrics: { pixels: data.length, twoCodewordMse: errors[0], eightCodewordMse: errors[2],
        eightCodewordIndexBits: data.length * 3, uncompressedFloat64Bits: data.length * 64, paletteOverheadBits: 8 * 64 },
      checks: [
        check('Every Lloyd distortion history is nonincreasing', fits.every(f => monotone(f.history))),
        check('Larger warm-start codebooks reduce distortion', monotone(errors) && errors[2] < errors[0]),
        check('Encoder uses nearest final codeword', fits.every(f => data.every((v, i) =>
          (v - f.centers[f.assignments[i]]) ** 2 <= Math.min(...f.centers.map(c => (v - c) ** 2)) + 1e-14))),
        check('Decoded image equals codebook lookup', fits.every(f => f.reconstruction.every((v, i) => v === f.centers[f.assignments[i]]))),
      ],
    };
  },
);

const ngramDemo = definition(
  'ngramPlot', 'Generated-text unigram and bigram plots',
  'Direct character counting, normalized joint frequencies and row-conditional transition probabilities',
  'Show the actual character distribution and bigram structure of a small seeded generated corpus.',
  ['Newly authored template-generated text replaces Darwin/ngramData; it is synthetic text, not recovered source data.',
    'Lowercase a–z plus space; repeated spaces collapse before counting. This makes endpoint count identities explicit.',
    'Square-scatter matrices replace Hinton diagrams; matrix indices 0=space,1=a,...,26=z.'],
  seed => {
    const random = seededRandom(seed), nouns = ['robot', 'garden', 'signal', 'river', 'model', 'cloud'];
    const verbs = ['finds', 'maps', 'joins', 'counts', 'follows', 'tests'];
    const adjectives = ['tiny', 'bright', 'quiet', 'local', 'sparse', 'noisy'];
    const pick = (words: string[]) => words[Math.floor(random() * words.length)];
    const text = range(28).map(() => `the ${pick(adjectives)} ${pick(nouns)} ${pick(verbs)} a ${pick(adjectives)} ${pick(nouns)}`).join(' ');
    const counts = countNgrams(text), n = counts.corpus.length, total = sum(counts.bigrams.flat());
    const joint = counts.bigrams.map(row => row.map(v => v / total));
    const conditional = counts.bigrams.map(row => sum(row) ? row.map(v => v / sum(row)) : row.map(() => 0));
    const last = counts.alphabet.indexOf(counts.corpus.at(-1)!);
    const marginalError = maxDiff(counts.bigrams.map(sum), counts.unigrams.map((v, i) => v - Number(i === last)));
    return {
      plots: [
        curve('Generated-corpus unigram probabilities', [bar('Character probability', [...counts.alphabet].map(ch => ch === ' ' ? 'space' : ch), counts.unigrams.map(v => v / n))], 'Character', 'Probability'),
        matrixPlot('Joint bigram probabilities: row=from, column=to', joint),
        matrixPlot('Conditional bigrams: row=from, column=to', conditional),
      ],
      metrics: { characters: n, bigramPairs: total, alphabetSize: 27, outgoingCountError: marginalError, corpus: counts.corpus,
        corpusSource: 'Seeded original template-generated text, not Darwin' },
      checks: [
        check('Unigrams count every character', sum(counts.unigrams) === n),
        check('Bigrams count exactly adjacent pairs', total === n - 1),
        check('Outgoing counts equal unigrams minus final character', marginalError === 0),
        check('Joint frequencies sum to one', Math.abs(sum(joint.flat()) - 1) < 1e-12),
        check('Nonempty conditional rows normalize', conditional.every((row, i) => Math.abs(sum(row) - Number(sum(counts.bigrams[i]) > 0)) < 1e-12)),
      ],
    };
  },
);

const tinyWeb = [[1, 5], [2, 3], [3, 4, 5], [0], [], [0]];
const walkDemo = definition(
  'pagerankDemo', 'Tiny-web random-surfer PageRank',
  'Bounded seeded Markov traversal versus the exact stationary distribution',
  'Run 30,000 local hops on the original six-node graph, including teleportation and dangling-node handling.',
  ['Uses the original graph and damping 0.85, not generated or recovered web data.',
    'The original exits before its interactive infinite loop; this replacement deliberately enables a finite local simulation.',
    'Shows empirical visits separately from exact PageRank; no animation, network access, or claim that simulation is the production ranking algorithm.'],
  seed => {
    const model = pageRank(tinyWeb), random = seededRandom(seed), counts = range(6).map(() => 0);
    const checkpoints: number[] = [], distances: number[] = [], path: number[] = [];
    let current = 0;
    for (let t = 1; t <= 30000; t++) {
      const outgoing = tinyWeb[current];
      current = outgoing.length && random() < .85 ? outgoing[Math.floor(random() * outgoing.length)] : Math.floor(random() * 6);
      counts[current]++;
      if (path.length < 80) path.push(current);
      if (t % 250 === 0) {
        checkpoints.push(t);
        distances.push(sum(counts.map((v, i) => Math.abs(v / t - model.direct[i]))));
      }
    }
    const empirical = counts.map(c => c / 30000), error = sum(empirical.map((v, i) => Math.abs(v - model.direct[i])));
    return {
      plots: [
        matrixPlot('Original six-node graph: row=destination, column=source', adjacencyImage(tinyWeb)),
        curve('Exact ranking versus empirical visits', [bar('Exact stationary probability', range(6), model.direct), bar('30,000-hop frequency', range(6), empirical)], 'Node (zero-based)', 'Probability'),
        curve('Empirical convergence (not monotonic in general)', [line('L1 distance to exact ranking', checkpoints, distances)], 'Hops', 'L1 error'),
        curve('First 80 local random-surfer positions', [line('Visited node', range(path.length), path)], 'Hop', 'Node'),
      ],
      metrics: { hops: 30000, damping: .85, stationaryResidual: model.residual, empiricalL1Error: error,
        visits: sum(counts), danglingNodes: 1, variant: 'Random-surfer simulation on original tiny web' },
      checks: [
        check('Stationary ranking satisfies transition equation', model.residual < 1e-12),
        check('Every hop is counted', sum(counts) === 30000),
        check('Empirical ranking is close to exact stationary distribution', error < .08, `L1 error ${error}`),
        check('Stationary probabilities sum to one', Math.abs(sum(model.direct) - 1) < 1e-12),
      ],
    };
  },
);

const molerDemo = definition(
  'pagerankDemoMoler', 'Moler PageRank linear-system solution',
  'Normalized (I - p G D) inverse applied to ones, checked by uniform-teleport power iteration',
  'Remove self-links, handle dangling columns, and compare the direct normalized resolvent with iterative PageRank.',
  ['Seeded eight-node local graph replaces the original call to the external surfer; generated nodes are not recovered URLs.',
    'Preserves original self-link removal and normalized linear-system method; uses the shared pivoted solver.',
    'Uniform dangling redistribution is implicit in the normalized resolvent and explicit in the independent power check.'],
  seed => {
    const random = seededRandom(seed);
    const links = range(8).map(i => i === 7 ? [] : [...new Set([
      i, (i + 1) % 8, ...range(8).filter(j => random() < .19),
    ])]);
    const model = pageRank(links, .85, true), labels = range(8).map(i => `local-${i}`);
    const error = maxDiff(model.direct, model.power);
    return {
      plots: [
        matrixPlot('Generated graph after self-link removal', adjacencyImage(model.adjacency)),
        curve('Moler direct solution versus power iteration', [bar('Normalized linear solve', labels, model.direct), bar('Power iteration', labels, model.power)], 'Generated local node', 'PageRank'),
        curve('Power iteration convergence', [line('Successive iterate L1 difference', range(model.history.length), model.history)], 'Iteration', 'L1 difference'),
        curve('Local in-degree and out-degree', [bar('In-degree', labels, range(8).map(j => model.adjacency.filter(row => row.includes(j)).length)),
          bar('Out-degree', labels, model.adjacency.map(row => row.length))]),
      ],
      metrics: { damping: .85, nodes: 8, removedSelfLinks: links.filter((row, i) => row.includes(i)).length,
        danglingNodes: model.adjacency.filter(row => !row.length).length, stationaryResidual: model.residual,
        directPowerError: error, iterations: model.history.length, variant: 'Normalized Moler linear-system solve, not visit sampling' },
      checks: [
        check('All self-links are removed', model.adjacency.every((row, i) => !row.includes(i))),
        check('Normalized solve equals stochastic power iteration', error < 1e-12),
        check('Direct ranking satisfies stationary equation', model.residual < 1e-12),
        check('Dangling nodes retain positive probability', model.adjacency.some(row => !row.length) && model.direct.every(v => v > 0)),
      ],
    };
  },
);

const surferDemo = definition(
  'surfer', 'Finite local graph discovery',
  'Breadth-first traversal with deduplication and a strict resident-node cap',
  'Model the graph-discovery effect safely on a generated local graph with cycles, duplicates, and unreachable nodes.',
  ['No external crawl, HTTP, URLs, HTML parsing, downloads, or execution of the original surfer.',
    'A seeded 12-node adjacency list, with an isolated node, replaces web pages; at most nine reachable nodes are admitted.',
    'FIFO traversal advances once per admitted node, eliminating the original retry-forever failure mode.'],
  seed => {
    const random = seededRandom(seed);
    const links = range(12).map(i => i === 11 ? [] : [(i + 1) % 11, (i + 1) % 11, i,
      ...range(11).filter(() => random() < .12)]);
    const traversal = traverseLocal(links, 0, 9), discovered = zeros(traversal.ids.length, traversal.ids.length);
    traversal.edges.forEach(([from, to]) => { discovered[to][from] = 1; });
    const depthValid = traversal.ids.every((id, i) => i === 0 || traversal.ids.slice(0, i).some((parent, j) =>
      links[parent].includes(id) && traversal.depths[i] === traversal.depths[j] + 1));
    return {
      plots: [
        matrixPlot('Generated resident graph (node 11 isolated)', adjacencyImage(links)),
        matrixPlot('Discovered graph: row=destination, column=source', discovered),
        curve('Unique admitted-node discovery', [line('Admitted nodes', range(traversal.cumulative.length), traversal.cumulative)], 'Processed local node', 'Unique nodes admitted'),
        curve('FIFO order and shortest discovery depth', [bar('BFS depth', traversal.ids, traversal.depths)], 'Original local node ID in discovery order', 'Hop depth'),
      ],
      metrics: { residentNodes: 12, nodeCap: 9, discoveredNodes: traversal.ids.length, processedNodes: traversal.cumulative.length,
        uniqueEdges: sum(discovered.flat()), externalRequests: 0, graphSource: 'Generated finite local adjacency lists' },
      checks: [
        check('Admission cap and unique-node invariant hold', traversal.ids.length <= 9 && new Set(traversal.ids).size === traversal.ids.length),
        check('Every admitted node is processed exactly once', traversal.cumulative.length === traversal.ids.length),
        check('Discovery depths have valid predecessor edges', depthValid),
        check('Unreachable resident node is never admitted', !traversal.ids.includes(11)),
        check('Recorded edges exist in the resident graph', traversal.edges.every(([from, to]) => links[traversal.ids[from]].includes(traversal.ids[to]))),
      ],
      notes: ['Column and row indices in the discovered matrix refer to FIFO discovery order, not original resident IDs.'],
    };
  },
);

const memoryDemo = definition(
  'memoryMapDemo', 'Typed-array buffer views and indexed access',
  'Aligned Int16 / Int8 views over one ArrayBuffer, DataView index oracle and chunked means',
  'Show actual shared-buffer aliasing, byte offsets, indexed synthetic glyph access, and write-through pixel changes.',
  ['This is NOT OS memory mapping, memmapfile, a mapped file, cache timing, or disk I/O; no server or file changes.',
    'Generated 8x8 seven-segment digit-like glyphs replace MNIST; 12 training and 6 test rows use row-major layout, not MATLAB column-major storage.',
    'Native-endian Int16 pixel views and Int8 label views use explicit aligned offsets; DataView verifies the same byte/index interpretation.'],
  seed => {
    const random = seededRandom(seed), pixels = 64, trainCount = 12, testCount = 6;
    const trainBytes = trainCount * pixels * 2, trainLabelOffset = trainBytes;
    const testOffset = Math.ceil((trainLabelOffset + trainCount) / 2) * 2;
    const testLabelOffset = testOffset + testCount * pixels * 2, totalBytes = testLabelOffset + testCount;
    const buffer = new ArrayBuffer(totalBytes);
    const train = new Int16Array(buffer, 0, trainCount * pixels), trainLabels = new Int8Array(buffer, trainLabelOffset, trainCount);
    const test = new Int16Array(buffer, testOffset, testCount * pixels), testLabels = new Int8Array(buffer, testLabelOffset, testCount);
    const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, view = new DataView(buffer);
    const segments = ['abcedf', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abcdfg'];
    const segmentAt = (r: number, c: number) =>
      r === 1 && c >= 2 && c <= 5 ? 'a' : r === 6 && c >= 2 && c <= 5 ? 'd' :
      r === 3 && c >= 2 && c <= 5 ? 'g' : c === 1 && r === 2 ? 'f' :
      c === 1 && r >= 4 && r <= 5 ? 'e' : c === 6 && r === 2 ? 'b' : c === 6 && r >= 4 && r <= 5 ? 'c' : '';
    const fill = (target: Int16Array, labels: Int8Array) => labels.forEach((_, i) => {
      const digit = Math.floor(random() * 10);
      labels[i] = digit;
      for (let j = 0; j < pixels; j++) {
        const segment = segmentAt(Math.floor(j / 8), j % 8);
        target[i * pixels + j] = segment && segments[digit].includes(segment) ? 230 + Math.floor(25 * random()) : Math.floor(18 * random());
      }
    });
    fill(train, trainLabels); fill(test, testLabels);
    const chosen = Math.floor(random() * trainCount);
    const indexed = Array.from(train.subarray(chosen * pixels, (chosen + 1) * pixels));
    const explicit = range(pixels).map(j => view.getInt16(2 * (chosen * pixels + j), littleEndian));
    const before = Array.from(train.subarray(0, pixels)), alias = train.subarray(30, 36);
    alias.fill(255);
    const after = Array.from(train.subarray(0, pixels));
    const chunked = range(testCount).map(row => {
      let total = 0;
      for (let start = 0; start < pixels; start += 11) {
        const chunk = test.subarray(row * pixels + start, row * pixels + Math.min(pixels, start + 11));
        total += Array.from(chunk).reduce((a, b) => a + b, 0);
      }
      return total / pixels;
    });
    const direct = range(testCount).map(row => mean(Array.from(test.subarray(row * pixels, (row + 1) * pixels))));
    const asImage = (data: number[]) => range(8).map(i => data.slice(i * 8, (i + 1) * 8));
    const testViewError = Math.max(...range(test.length).map(i => Math.abs(test[i] - view.getInt16(testOffset + 2 * i, littleEndian))));
    return {
      plots: [
        matrixPlot(`Indexed synthetic training glyph ${chosen}, label ${trainLabels[chosen]}`, asImage(indexed)),
        matrixPlot('Training row 0 before buffer-view mutation', asImage(before)),
        matrixPlot('Same buffer row after setting pixels 30..35 to 255', asImage(after)),
        matrixPlot('Synthetic test buffer: examples by pixel index', range(testCount).map(row => Array.from(test.subarray(row * pixels, (row + 1) * pixels)))),
        curve('Indexed Int16 view versus byte-offset DataView', [line('Int16Array indexed row', range(pixels), indexed), line('DataView explicit byte offsets', range(pixels), explicit)], 'Row-major pixel index', 'Integer intensity'),
        curve('Chunked versus direct test-row means', [bar('Chunks of 11 pixels', range(testCount), chunked), bar('Direct row mean', range(testCount), direct)], 'Test row', 'Mean intensity'),
        curve('Shared buffer label sections', [bar('Train labels', range(trainCount), Array.from(trainLabels)), bar('Test labels', range(testCount), Array.from(testLabels))]),
      ],
      metrics: { trainRows: trainCount, testRows: testCount, pixelsPerRow: pixels, allocatedBytes: totalBytes, trainBytes,
        trainLabelOffset, testOffset, testLabelOffset, selectedRow: chosen, indexOracleError: maxDiff(indexed, explicit),
        testViewOracleError: testViewError, chunkedMeanError: maxDiff(chunked, direct),
        storage: 'In-memory ArrayBuffer only; no OS memory mapping', byteOrder: littleEndian ? 'little-endian native' : 'big-endian native' },
      checks: [
        check('Int16 indexed reads equal DataView byte-offset reads', maxDiff(indexed, explicit) === 0 && testViewError === 0),
        check('Subarray writes alias the original buffer', range(6).every(j => train[30 + j] === 255 && view.getInt16((30 + j) * 2, littleEndian) === 255)),
        check('Only the requested six pixels changed in row zero', after.every((v, j) => j >= 30 && j < 36 ? v === 255 : v === before[j])),
        check('Chunked means equal direct row means', maxDiff(chunked, direct) === 0),
        check('Sections fit, do not overlap and are aligned', testOffset % 2 === 0 && testOffset >= trainLabelOffset + trainCount && testLabelOffset + testCount === buffer.byteLength),
      ],
      notes: ['All buffer storage is modest and local to this run; indexed lookup demonstrates aliasing and layout, not paging performance.'],
    };
  },
);

export const graphicalReproductions: Reproduction[] = [
  chainDemo, structureDemo, hmmDemo, qmrDemo, dgmDemo, convolutionDemo, svdDemo,
  vqDemo, ngramDemo, walkDemo, molerDemo, surferDemo, memoryDemo,
];
