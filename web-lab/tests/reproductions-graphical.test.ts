import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chainObjective, convolveSame, countNgrams, graphicalReproductions, imageSvd, inferSpinChain,
  isingPseudoObjective, kBestHmm, noisyOrPosterior, noisyOrQuickscore, pageRank, quantizeGray, traverseLocal,
} from '../shared/reproductions/graphical.js';
import type { ExperimentResult, VisualPlot } from '../shared/reproductions/types.js';

const ids = [
  'crf2ChainTrainDemo', 'crfFitStructDemo', 'hmmNbestDemo', 'qmrDemo', 'randDgmTimingTest',
  'imageConvDemo', 'svdImageDemo', 'vqDemo', 'ngramPlot', 'pagerankDemo', 'pagerankDemoMoler', 'surfer', 'memoryMapDemo',
];
const seeds = [0, 19, 2026];
const total = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => total(a) / a.length;
const close = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const vectorClose = (actual: number[], expected: number[], tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => close(v, expected[i], tolerance));
};
const mse = (a: number[], b: number[]) => mean(a.map((v, i) => (v - b[i]) ** 2));
const cache = new Map<string, ExperimentResult>();
const run = (id: string, seed = 19) => {
  const key = `${id}/${seed}`;
  if (!cache.has(key)) {
    const definition = graphicalReproductions.find(r => r.id === id);
    assert.ok(definition, id);
    cache.set(key, definition.run(seed));
  }
  return cache.get(key)!;
};
function plot(result: ExperimentResult, title: string) {
  const found = result.plots.find(p => p.title === title);
  assert.ok(found, `Missing plot: ${title}`);
  return found;
}
function raster(p: VisualPlot) {
  assert.equal(p.traces.length, 1);
  const trace = p.traces[0], colors = trace.marker?.color;
  assert.ok(Array.isArray(colors), p.title);
  const x = trace.x as number[], y = trace.y, rows = 1 - Math.min(...y), cols = 1 + Math.max(...x);
  const data = Array.from({ length: rows }, () => Array<number>(cols).fill(NaN));
  colors.forEach((v, i) => { data[-y[i]][x[i]] = v; });
  assert.ok(data.flat().every(Number.isFinite));
  return data;
}
function binaryStates(n: number) {
  return Array.from({ length: 2 ** n }, (_, mask) => Array.from({ length: n }, (_, i) => mask >> i & 1));
}
function spinOracle(fields: number[], couplings: number[]) {
  const states = binaryStates(fields.length).map(s => s.map(x => 2 * x - 1));
  const scores = states.map(s => total(s.map((v, j) => fields[j] * v)) +
    total(couplings.map((v, j) => v * s[j] * s[j + 1])));
  const z = total(scores.map(Math.exp)), probabilities = scores.map(v => Math.exp(v) / z);
  return { states, scores, probabilities, logZ: Math.log(z) };
}
function numericalGradient(fun: (w: number[]) => number, weights: number[]) {
  return weights.map((_, j) => {
    const a = weights.slice(), b = weights.slice(), h = 1e-5;
    a[j] += h; b[j] -= h;
    return (fun(a) - fun(b)) / (2 * h);
  });
}

test('exactly the thirteen authorized definitions expose honest provenance', () => {
  assert.deepEqual(graphicalReproductions.map(r => r.id), ids);
  assert.equal(new Set(ids).size, 13);
  for (const r of graphicalReproductions) {
    assert.equal(r.source, `demos/${r.id}.m`);
    assert.ok(r.title.length > 5 && r.method.length > 15 && r.description.length > 20);
    assert.ok(r.differences.length >= 2 && r.differences.every(d => d.length > 20));
  }
  assert.match(graphicalReproductions.find(r => r.id === 'memoryMapDemo')!.differences.join(' '), /NOT OS memory mapping/);
  assert.match(graphicalReproductions.find(r => r.id === 'surfer')!.differences.join(' '), /No external crawl/);
  assert.match(graphicalReproductions.find(r => r.id === 'qmrDemo')!.differences.join(' '), /not finished/);
});

for (const seed of seeds) for (const id of ids) {
  test(`${id} seed ${seed}: finite bounded Plotly-basic shapes and numerical self-checks`, () => {
    const result = run(id, seed);
    assert.ok(result.plots.length >= 3);
    assert.ok(Object.keys(result.metrics).length >= 4);
    assert.ok(result.checks.length >= 3);
    assert.deepEqual(result.checks.filter(c => !c.passed), [], id);
    let points = 0;
    for (const p of result.plots) {
      assert.ok(p.title.length > 0 && p.traces.length > 0);
      for (const t of p.traces) {
        assert.ok(t.type === 'scatter' || t.type === 'bar');
        assert.ok(t.x.length > 0);
        assert.equal(t.x.length, t.y.length);
        assert.ok(t.x.every(v => typeof v === 'string' || Number.isFinite(v)));
        assert.ok(t.y.every(Number.isFinite));
        if (Array.isArray(t.marker?.color)) {
          assert.equal(t.marker.color.length, t.x.length);
          assert.ok(t.marker.color.every(Number.isFinite));
        }
        points += t.x.length;
      }
    }
    assert.ok(points < 20000, `Bounded rendering: ${points} points`);
    Object.values(result.metrics).forEach(v => assert.ok(typeof v === 'string' || Number.isFinite(v)));
    assert.ok(JSON.stringify(result).length < 250000);
  });
}

test('all thirteen results are deterministic for the same seed, including scaling data', () => {
  for (const r of graphicalReproductions) assert.deepEqual(r.run(19), run(r.id, 19), r.id);
});

test('spin-chain partition, node marginals, edge moments and MAP match independent exhaustive enumeration', () => {
  for (const [fields, couplings] of [
    [[.7], []],
    [[.2, -.8, .4], [.9, -.6]],
    [[0, 0, 0, 0], [1, -.4, .2]],
  ]) {
    const oracle = spinOracle(fields, couplings), actual = inferSpinChain(fields, couplings);
    close(actual.logZ, oracle.logZ);
    fields.forEach((_, j) => {
      const expected = total(oracle.probabilities.map((p, i) => oracle.states[i][j] === 1 ? p : 0));
      close(actual.marginals[j][1], expected);
      close(total(actual.marginals[j]), 1);
    });
    couplings.forEach((_, j) => close(actual.correlations[j],
      total(oracle.probabilities.map((p, i) => p * oracle.states[i][j] * oracle.states[i][j + 1]))));
    close(actual.mapScore, Math.max(...oracle.scores));
    const found = oracle.states.findIndex(s => s.every((v, j) => v === actual.path[j]));
    close(oracle.scores[found], Math.max(...oracle.scores));
  }
});

test('chain CRF objective is the actual exhaustive conditional NLL; all feature gradients match finite differences', () => {
  const weights = [.1, -.3, .25, .17];
  const data = [
    { season: -1, labels: [-1, 1, 1] }, { season: .3, labels: [1, 1, -1] }, { season: 1, labels: [-1, -1, 1] },
  ];
  for (const variant of [0, 1, 2]) {
    const expected = mean(data.map(({ season, labels }) => {
      const field = weights[0] + (variant > 0 ? weights[1] * season : 0);
      const coupling = weights[2] + (variant > 1 ? weights[3] * season : 0);
      const oracle = spinOracle(labels.map(() => field), [coupling, coupling]);
      return oracle.logZ - field * total(labels) - coupling * (labels[0] * labels[1] + labels[1] * labels[2]);
    })) + .02 / 2 * total(weights.map(v => v * v));
    const actual = chainObjective(weights, data, variant);
    close(actual.value, expected);
    vectorClose(actual.gradient, numericalGradient(w => chainObjective(w, data, variant).value, weights), 1e-8);
  }
});

test('chain CRF displayed final weights independently reproduce its trained objective and posterior images', () => {
  for (const seed of seeds) {
    const result = run('crf2ChainTrainDemo', seed);
    const truth = raster(plot(result, 'Generated binary truth: cases by chain position'));
    const w = plot(result, 'Learned tied full-model weights').traces[0].y;
    const data = truth.map((labels, i) => ({ labels, season: Math.cos(2 * Math.PI * Math.floor(i / 6) / 12) }));
    close(chainObjective(w, data, 2).value, result.metrics.finalObjective as number);
    const marginals = raster(plot(result, 'Full model P(spin = +1)'));
    for (const row of [0, 17, 40, 71]) {
      const f = w[0] + w[1] * data[row].season, j = w[2] + w[3] * data[row].season;
      const oracle = spinOracle(Array(8).fill(f), Array(7).fill(j));
      marginals[row].forEach((value, t) => close(value,
        total(oracle.probabilities.map((p, index) => oracle.states[index][t] === 1 ? p : 0))));
    }
    const curves = plot(result, 'Exact penalized conditional NLL per sequence').traces;
    curves.forEach(trace => {
      assert.ok(trace.y.at(-1)! < trace.y[0] - .01);
      trace.y.slice(1).forEach((v, i) => assert.ok(v <= trace.y[i] + 1e-10));
    });
  }
});

test('Ising pseudolikelihood equals explicit conditional Bernoulli log losses and its symmetric-edge gradient is correct', () => {
  const edges = [[0, 1], [0, 2], [1, 2]], weights = [.1, -.2, .3, .4, -.5, .2];
  const data = [[-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1]];
  let expected = 0;
  for (const s of data) for (let node = 0; node < 3; node++) {
    let h = weights[node];
    edges.forEach(([a, b], e) => { if (node === a) h += weights[3 + e] * s[b]; if (node === b) h += weights[3 + e] * s[a]; });
    expected -= Math.log(Math.exp(h * s[node]) / (Math.exp(h) + Math.exp(-h))) / (data.length * 3);
  }
  expected += .01 / 2 * total(weights.slice(0, 3).map(v => v * v));
  const actual = isingPseudoObjective(weights, data, edges);
  close(actual.value, expected);
  vectorClose(actual.gradient, numericalGradient(w => isingPseudoObjective(w, data, edges).value, weights), 1e-8);
});

test('sparse CRF output contains actual zero edge weights and exact model marginals, not thresholded decoration', () => {
  for (const seed of seeds) {
    const result = run('crfFitStructDemo', seed);
    const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
    const weights = plot(result, 'True versus selected edge weights').traces[1].y;
    const biases = plot(result, 'Learned node biases at lambda=0.08').traces[0].y;
    const counts = plot(result, 'Active undirected edges on regularization path').traces[0].y;
    assert.equal(counts[2], weights.filter(w => Math.abs(w) > 1e-5).length);
    assert.equal(counts[3], 0);
    assert.ok(weights.some(w => w === 0) && weights.some(w => Math.abs(w) > .05));
    const matrix = raster(plot(result, 'Learned weights, lambda = 0.08'));
    edges.forEach(([a, b], e) => { close(matrix[a][b], weights[e]); close(matrix[b][a], weights[e]); });
    const states = binaryStates(5).map(s => s.map(v => v * 2 - 1));
    const masses = states.map(s => Math.exp(total(biases.map((b, j) => b * s[j])) + total(edges.map(([a, b], e) => weights[e] * s[a] * s[b]))));
    const z = total(masses);
    close(Math.log(z), result.metrics.exactLogPartition as number);
    const expected = biases.map((_, j) => total(masses.map((p, i) => states[i][j] === 1 ? p : 0)) / z);
    vectorClose(plot(result, 'Exact learned-model node marginals').traces[0].y, expected);
  }
});

function hmmOracle(initial: number[], transition: number[][], emission: number[][], observations: number[]) {
  return binaryStates(observations.length).map(path => {
    let probability = initial[path[0]] * emission[path[0]][observations[0]];
    for (let t = 1; t < observations.length; t++) probability *= transition[path[t - 1]][path[t]] * emission[path[t]][observations[t]];
    return { path, probability };
  }).sort((a, b) => b.probability - a.probability);
}

test('k-best HMM returns true top-k joint paths on varied small models, including k larger than path count', () => {
  for (const observations of [[0], [1, 0, 1], [0, 1, 1, 0, 1]]) {
    const initial = [.37, .63], transition = [[.81, .19], [.23, .77]], emission = [[.72, .28], [.14, .86]];
    const oracle = hmmOracle(initial, transition, emission, observations);
    for (const k of [1, 3, 50]) {
      const actual = kBestHmm(initial, transition, emission, observations, k);
      assert.equal(actual.length, Math.min(k, oracle.length));
      assert.equal(new Set(actual.map(p => p.path.join(''))).size, actual.length);
      actual.forEach((v, i) => {
        close(Math.exp(v.score), oracle[i].probability, 1e-14);
        const own = oracle.find(x => x.path.join('') === v.path.join(''))!;
        close(Math.exp(v.score), own.probability, 1e-14);
      });
    }
  }
});

test('HMM displayed paths, posterior bars and likelihood match a separate exhaustive product oracle on original parameters', () => {
  const result = run('hmmNbestDemo');
  const oracle = hmmOracle([.6, .4], [[.6, .4], [.2, .8]], [[.9, .1], [.3, .7]], [0, 0, 1, 1, 1, 1, 0, 0, 1, 1]);
  const likelihood = total(oracle.map(p => p.probability));
  close(result.metrics.sequenceProbability as number, likelihood, 1e-14);
  const paths = raster(plot(result, 'Top six state paths (best at row zero)'));
  const posterior = plot(result, 'Path posterior probabilities').traces[0].y;
  paths.forEach((path, i) => {
    const found = oracle.find(p => p.path.join('') === path.join(''))!;
    close(found.probability, oracle[i].probability, 1e-14);
    close(posterior[i], found.probability / likelihood);
  });
});

test('noisy-OR positive, negative, hidden and explaining-away analytical cases', () => {
  const positive = noisyOrPosterior([.1], [[.2]], [1], [1]);
  close(positive.evidenceProbability, .08);
  close(positive.posterior[0], 1);
  const p = [.2, .3], q = [[.4], [.7]];
  const negative = noisyOrPosterior(p, q, [.9], [0]);
  vectorClose(negative.posterior, [.2 * .4 / (.8 + .2 * .4), .3 * .7 / (.7 + .3 * .7)]);
  vectorClose(noisyOrPosterior(p, q, [.9], [null]).posterior, p);
  const explainingAway = noisyOrPosterior(p, [[0], [0]], [1], [1]);
  close(explainingAway.evidenceProbability, .44);
  vectorClose(explainingAway.posterior, [.2 / .44, .3 / .44]);
  assert.ok(.06 / .44 < explainingAway.posterior[0] * explainingAway.posterior[1]);
  for (const evidence of [[null], [0], [1]]) {
    const a = noisyOrPosterior(p, q, [.9], evidence), b = noisyOrQuickscore(p, q, [.9], evidence);
    vectorClose(a.posterior, b.posterior);
    close(a.evidenceProbability, b.evidenceProbability);
  }
});

test('QMR displayed parameters independently determine nontrivial posterior disease and repeat-finding probabilities', () => {
  for (const seed of seeds) {
    const result = run('qmrDemo', seed);
    const bars = plot(result, 'Disease prior and posterior').traces;
    const prior = bars[0].y, actual = bars[1].y;
    const inhibit = raster(plot(result, 'Noisy-OR inhibition (1 means absent link)'));
    const leak = plot(result, 'Finding absent-leak probabilities').traces[0].y;
    const evidence = [null, 1, 1, 1, 0, 0, 0, null], numerator = Array(6).fill(0), predictive = Array(8).fill(0);
    let denominator = 0;
    for (const state of binaryStates(6)) {
      const absent = leak.map((l, f) => l * state.reduce((v, active, d) => v * (active ? inhibit[d][f] : 1), 1));
      let weight = state.reduce((v, active, d) => v * (active ? prior[d] : 1 - prior[d]), 1);
      evidence.forEach((finding, f) => { weight *= finding === null ? 1 : finding ? 1 - absent[f] : absent[f]; });
      denominator += weight;
      state.forEach((active, d) => { numerator[d] += weight * active; });
      absent.forEach((p, f) => { predictive[f] += weight * (1 - p); });
    }
    close(result.metrics.evidenceProbability as number, denominator);
    vectorClose(actual, numerator.map(v => v / denominator));
    vectorClose(plot(result, 'Predictive repeat findings under posterior diseases').traces[0].y, predictive.map(v => v / denominator));
    assert.ok(actual.some((v, i) => Math.abs(v - prior[i]) > .01));
  }
});

test('random chain DGM operation counts match loop algebra, and plotted marginals respect final-node evidence', () => {
  for (const seed of seeds) {
    const result = run('randDgmTimingTest', seed);
    const traces = plot(result, 'Instrumented multiplications, not elapsed time').traces;
    assert.deepEqual(traces[0].x, [2, 3, 4, 5]);
    vectorClose(traces[0].y, [2, 3, 4, 5].map(k => 10 * k * k + 6 * k), 0);
    vectorClose(traces[1].y, [2, 3, 4, 5].map(k => 6 * k ** 6), 0);
    const marginals = raster(plot(result, 'Conditional node marginals at five states'));
    marginals.forEach(row => close(total(row), 1));
    vectorClose(marginals[5], [1, 0, 0, 0, 0]);
    assert.match(result.metrics.benchmark as string, /no host timing measurement/);
  }
});

test('convolution reverses the kernel, keeps the centered same shape, and obeys impulse and constant identities', () => {
  const impulse = [[0, 0, 0, 1, 0, 0, 0]];
  vectorClose(convolveSame(impulse, [[1, 2, 3]])[0], [0, 0, 1, 2, 3, 0, 0], 0);
  const ramp = [Array.from({ length: 9 }, (_, i) => i)];
  vectorClose(convolveSame(ramp, [[.5, 0, -.5]])[0].slice(1, -1), Array(7).fill(1), 0);
  assert.throws(() => convolveSame([[1, 2]], [[-1, 1]]), /odd/);
  vectorClose(convolveSame([[1, 2, 3]], [[1]])[0], [1, 2, 3], 0);
});

test('image-convolution displayed pixels equal a separately indexed zero-padding oracle', () => {
  for (const seed of seeds) {
    const result = run('imageConvDemo', seed);
    const image = raster(plot(result, 'Generated scene (not clown)'));
    const kernel = raster(plot(result, 'Normalized Gaussian kernel'));
    const blur = raster(plot(result, 'Gaussian-smoothed scene'));
    close(total(kernel.flat()), 1);
    const pixel = (r: number, c: number) => image[r]?.[c] ?? 0;
    for (const [r, c] of [[0, 0], [3, 8], [12, 14], [23, 27]]) {
      let expected = 0;
      kernel.forEach((row, i) => row.forEach((v, j) => { expected += v * pixel(r + 3 - i, c + 3 - j); }));
      close(blur[r][c], expected);
    }
    const dx = raster(plot(result, 'Raw centered x derivative'));
    dx.forEach((row, i) => row.forEach((v, j) => close(v, (pixel(i, j + 1) - pixel(i, j - 1)) / 2)));
    const dog = raster(plot(result, 'Derivative of Gaussian: x'));
    let expectedDog = 0;
    kernel.forEach((row, i) => row.forEach((v, j) => {
      expectedDog += -(j - 3) * v / 1.25 ** 2 * pixel(12 + 3 - i, 14 + 3 - j);
    }));
    close(dog[12][14], expectedDog);
  }
});

test('SVD reconstruction has analytical singular values, rank-one factors and orthogonal projectors on a rectangular matrix', () => {
  const input = [[3, 0], [0, 2], [0, 0]], decomposition = imageSvd(input);
  vectorClose(decomposition.singularValues, [3, 2, 0]);
  vectorClose(decomposition.reconstruct(1).flat(), [3, 0, 0, 0, 0, 0]);
  vectorClose(decomposition.reconstruct(2).flat(), input.flat());
  decomposition.vectors.forEach((a, i) => decomposition.vectors.forEach((b, j) =>
    close(total(a.map((v, k) => v * b[k])), Number(i === j))));
  const rankOne = [[2, 4, 6], [1, 2, 3], [-1, -2, -3]];
  vectorClose(imageSvd(rankOne).reconstruct(1).flat(), rankOne.flat(), 1e-9);
});

test('SVD plotted MSE is real pixel reconstruction error and equals spectral tail; scrambling preserves the multiset', () => {
  for (const seed of seeds) {
    const result = run('svdImageDemo', seed), original = raster(plot(result, 'Generated original scene')).flat();
    const ranks = [1, 2, 5, 10, 24];
    const spectrum = plot(result, 'Singular values').traces[0].y;
    const errors = ranks.map(k => mse(original, raster(plot(result, `Actual rank-${k} reconstruction`)).flat()));
    const shown = plot(result, 'Reconstruction MSE and spectral tail identity').traces;
    vectorClose(shown[0].y, errors);
    vectorClose(shown[1].y, ranks.map(k => total(spectrum.slice(k).map(s => s * s)) / original.length), 1e-10);
    close(total(spectrum.map(s => s * s)), total(original.map(v => v * v)), 1e-8);
    vectorClose(raster(plot(result, 'Seeded pixel permutation')).flat().sort((a, b) => a - b), original.slice().sort((a, b) => a - b), 0);
    assert.ok(errors[4] < 1e-18 && errors[0] > errors[3] * 5);
  }
});

test('Lloyd quantization solves an analytical two-cluster case and never increases distortion', () => {
  const fit = quantizeGray([0, 0, 2, 8, 10, 10], [0, 10]);
  vectorClose(fit.centers, [2 / 3, 28 / 3]);
  assert.deepEqual(fit.assignments, [0, 0, 0, 1, 1, 1]);
  close(fit.history.at(-1)!, 8 / 9);
  fit.history.slice(1).forEach((v, i) => assert.ok(v <= fit.history[i] + 1e-12));
  const empty = quantizeGray([1, 1, 1], [1, 100]);
  vectorClose(empty.reconstruction, [1, 1, 1]);
  assert.ok(empty.centers.every(Number.isFinite));
});

test('VQ decoded images use their actual codebook, nearest assignments, centroids, and recomputed MSE', () => {
  for (const seed of seeds) {
    const result = run('vqDemo', seed), original = raster(plot(result, 'Generated original scene')).flat();
    const palettes = plot(result, 'Learned intensity codebooks').traces;
    const errors = [2, 4, 8].map((k, index) => {
      const decoded = raster(plot(result, `Decoded ${k}-codeword scene`)).flat(), centers = palettes[index].y;
      assert.ok(new Set(decoded).size <= k);
      decoded.forEach((v, i) => {
        assert.ok(centers.includes(v));
        close((original[i] - v) ** 2, Math.min(...centers.map(c => (original[i] - c) ** 2)));
      });
      centers.forEach(center => {
        const cluster = original.filter((_, i) => decoded[i] === center);
        if (cluster.length) close(center, mean(cluster));
      });
      return mse(original, decoded);
    });
    vectorClose(plot(result, 'Rate-distortion comparison').traces[0].y, errors);
    assert.ok(errors[2] < errors[1] && errors[1] < errors[0]);
    assert.equal(result.metrics.eightCodewordIndexBits, original.length * 3);
  }
});

test('character counting obeys known endpoint counts and space normalization', () => {
  const counts = countNgrams('Aa  b! a');
  assert.equal(counts.corpus, 'aa b a');
  assert.equal(counts.unigrams[0], 2);
  assert.equal(counts.unigrams[1], 3);
  assert.equal(counts.unigrams[2], 1);
  assert.equal(counts.bigrams[1][1], 1);
  assert.equal(counts.bigrams[1][0], 1);
  assert.equal(counts.bigrams[0][1], 1);
  assert.equal(counts.bigrams[0][2], 1);
  assert.equal(counts.bigrams[2][0], 1);
  assert.equal(total(counts.bigrams.flat()), 5);
});

test('ngram plotted joint and conditional matrices are independent counts of the disclosed generated corpus', () => {
  for (const seed of seeds) {
    const result = run('ngramPlot', seed), corpus = result.metrics.corpus as string;
    const alphabet = ' abcdefghijklmnopqrstuvwxyz', uni = Array(27).fill(0), pairs = Array.from({ length: 27 }, () => Array(27).fill(0));
    for (let i = 0; i < corpus.length; i++) {
      const a = alphabet.indexOf(corpus[i]);
      uni[a]++;
      if (i) pairs[alphabet.indexOf(corpus[i - 1])][a]++;
    }
    vectorClose(plot(result, 'Generated-corpus unigram probabilities').traces[0].y, uni.map(n => n / corpus.length));
    vectorClose(raster(plot(result, 'Joint bigram probabilities: row=from, column=to')).flat(), pairs.flat().map(n => n / (corpus.length - 1)));
    vectorClose(raster(plot(result, 'Conditional bigrams: row=from, column=to')).flat(), pairs.flatMap(row => row.map(n => total(row) ? n / total(row) : 0)));
  }
});

test('Moler resolvent agrees with analytical dangling-graph PageRank and self-link removal changes the model correctly', () => {
  vectorClose(pageRank([[1], []]).direct, [20 / 57, 37 / 57]);
  vectorClose(pageRank([[], [], []]).direct, [1 / 3, 1 / 3, 1 / 3]);
  vectorClose(pageRank([[0, 1], [1]], .85, true).direct, [20 / 57, 37 / 57]);
  vectorClose(pageRank([[1], [0]], 0).direct, [.5, .5]);
  assert.ok(Math.abs(pageRank([[0, 1], [1]], .85, false).direct[0] - 20 / 57) > .05);
});

function stationaryResidual(links: number[][], probability: number[], damping = .85) {
  const n = probability.length, next = Array<number>(n).fill((1 - damping) / n);
  links.forEach((row, from) => {
    if (!row.length) next.forEach((_, j) => { next[j] += damping * probability[from] / n; });
    else row.forEach(to => { next[to] += damping * probability[from] / row.length; });
  });
  return Math.max(...next.map((p, j) => Math.abs(p - probability[j])));
}

test('PageRank variants expose different computations, and both satisfy their independent graph transition equations', () => {
  for (const seed of seeds) {
    const walk = run('pagerankDemo', seed), direct = run('pagerankDemoMoler', seed);
    const traces = plot(walk, 'Exact ranking versus empirical visits').traces;
    const links = [[1, 5], [2, 3], [3, 4, 5], [0], [], [0]];
    close(stationaryResidual(links, traces[0].y), 0);
    close(total(traces[1].y), 1);
    traces[1].y.forEach(p => close(p * 30000, Math.round(p * 30000), 1e-9));
    close(total(traces[0].y.map((p, i) => Math.abs(p - traces[1].y[i]))), walk.metrics.empiricalL1Error as number);
    assert.ok(total(traces[0].y.map((p, i) => Math.abs(p - traces[1].y[i]))) < .08);
    const matrix = raster(plot(direct, 'Generated graph after self-link removal'));
    const localLinks = matrix[0].map((_, from) => matrix.flatMap((row, to) => row[from] ? [to] : []));
    const ranking = plot(direct, 'Moler direct solution versus power iteration').traces;
    close(stationaryResidual(localLinks, ranking[0].y), 0);
    vectorClose(ranking[0].y, ranking[1].y, 1e-12);
    assert.notEqual(walk.metrics.variant, direct.metrics.variant);
    assert.equal(traces[0].y.length, 6);
    assert.equal(ranking[0].y.length, 8);
  }
});

test('finite local traversal handles cycles, duplicate links, unreachable nodes and hard caps', () => {
  const links = [[1, 1, 0], [2, 0], [0], []];
  const all = traverseLocal(links, 0, 10);
  assert.deepEqual(all.ids, [0, 1, 2]);
  assert.deepEqual(all.depths, [0, 1, 2]);
  assert.equal(all.cumulative.length, 3);
  assert.equal(all.edges.length, 5);
  assert.equal(new Set(all.edges.map(e => e.join(','))).size, 5);
  const capped = traverseLocal(links, 0, 2);
  assert.deepEqual(capped.ids, [0, 1]);
  assert.equal(capped.cumulative.length, 2);
  assert.deepEqual(traverseLocal(links, 3, 1).ids, [3]);
});

test('surfer output is the exact FIFO traversal of the visible resident graph with consistent induced edges', () => {
  for (const seed of seeds) {
    const result = run('surfer', seed), matrix = raster(plot(result, 'Generated resident graph (node 11 isolated)'));
    // The generation emits the successor first, then self, then additional links
    // in ascending ID order; a raster alone loses insertion order. Reconstruct
    // that declared local ordering without invoking the production traversal.
    const links = matrix[0].map((_, from) => from === 11 ? [] :
      [...new Set([(from + 1) % 11, from, ...matrix.flatMap((row, to) => row[from] ? [to] : [])])]);
    const expected = [0], depths = [0];
    for (let at = 0; at < expected.length; at++) for (const to of links[expected[at]]) {
      if (!expected.includes(to) && expected.length < 9) { expected.push(to); depths.push(depths[at] + 1); }
    }
    const shown = plot(result, 'FIFO order and shortest discovery depth').traces[0];
    assert.deepEqual(shown.x, expected);
    assert.deepEqual(shown.y, depths);
    const induced = raster(plot(result, 'Discovered graph: row=destination, column=source'));
    induced.forEach((row, to) => row.forEach((v, from) => assert.equal(v, Number(links[expected[from]].includes(expected[to])))));
    assert.equal(result.metrics.externalRequests, 0);
  }
});

test('memory-view output proves indexed data, isolated aliasing changes, exact byte layout and independently recomputed chunk means', () => {
  for (const seed of seeds) {
    const result = run('memoryMapDemo', seed), metrics = result.metrics;
    assert.equal(metrics.trainBytes, 12 * 64 * 2);
    assert.equal(metrics.trainLabelOffset, 1536);
    assert.equal(metrics.testOffset, 1536 + 12);
    assert.equal(metrics.testLabelOffset, 1548 + 6 * 64 * 2);
    assert.equal(metrics.allocatedBytes, 2322);
    assert.match(metrics.storage as string, /no OS memory mapping/);
    const before = raster(plot(result, 'Training row 0 before buffer-view mutation')).flat();
    const after = raster(plot(result, 'Same buffer row after setting pixels 30..35 to 255')).flat();
    after.forEach((v, j) => assert.equal(v, j >= 30 && j < 36 ? 255 : before[j]));
    assert.equal(after.filter((v, j) => v !== before[j]).length, 6);
    const indexed = plot(result, 'Indexed Int16 view versus byte-offset DataView').traces;
    vectorClose(indexed[0].y, indexed[1].y, 0);
    assert.ok(indexed[0].y.every(v => Number.isInteger(v) && v >= 0 && v <= 255));
    const selected = result.plots.find(p => p.title.startsWith('Indexed synthetic training glyph'))!;
    vectorClose(raster(selected).flat(), indexed[0].y, 0);
    const testPixels = raster(plot(result, 'Synthetic test buffer: examples by pixel index'));
    const means = plot(result, 'Chunked versus direct test-row means').traces;
    vectorClose(means[0].y, testPixels.map(mean), 0);
    vectorClose(means[1].y, testPixels.map(mean), 0);
    assert.ok(testPixels.flat().every(Number.isInteger));
  }
});
