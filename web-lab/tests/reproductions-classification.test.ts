import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificationReproductions, fitSoftmax, fitBinarySvm, fitEpsilonSvr,
  fitCart, predictCart, fitDiscriminant, fitGaussianNb, fitKernelRidge, rbmClassProbabilities, rbmHiddenProbabilities,
  fitRbm, cnnForward, cnnGradient, hopfieldWeights, hopfieldEnergy, recallHopfield,
  hamming, codePosterior,
} from '../shared/reproductions/classification.js';
import type { LabelRbm, TinyCnn } from '../shared/reproductions/classification.js';
import { linearFit } from '../shared/numerics.js';

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const ids = [
  'classificationShootout', 'classificationShootoutCvLambdaOnly', 'linearKernelDemo',
  'dtreeDemoIris', 'ldaQdaDemoIris', 'kernelBinaryClassifDemo', 'svmFitTest',
  'svmOneVsRestDemo', 'deepBelNetClassifyDemo', 'matconvnetDemo', 'hopfieldDemo',
  'codeBreaker', 'linregMlcompDemo',
];

test('registry has exactly the thirteen assigned source IDs', () => {
  assert.deepEqual(classificationReproductions.map(r => r.id), ids);
  for (const r of classificationReproductions) {
    assert.equal(r.source, `demos/${r.id}.m`);
    assert.ok(r.title && r.method && r.description && r.differences.length);
  }
});

for (const reproduction of classificationReproductions) {
  test(`${reproduction.id}: finite SVG bundle, deterministic, multiple independent seeds`, () => {
    const outputs: string[] = [];
    for (const seed of [0, 7, 42]) {
      const before = performance.now(), result = reproduction.run(seed), duration = performance.now() - before;
      assert.ok(duration < 1800, `${reproduction.id}: ${duration.toFixed(1)}ms exceeds bounded workload allowance`);
      assert.deepEqual(result, reproduction.run(seed), 'same seed must reproduce every metric/check/plot');
      outputs.push(JSON.stringify(result));
      assert.ok(result.plots.length && Object.keys(result.metrics).length && result.checks.length);
      assert.ok(result.notes?.length, 'changes and data provenance must be disclosed');
      for (const [name, value] of Object.entries(result.metrics)) {
        assert.ok(typeof value === 'string' || Number.isFinite(value), `nonfinite metric ${name}`);
      }
      for (const plot of result.plots) {
        assert.ok(plot.title && plot.traces.length);
        for (const trace of plot.traces) {
          assert.ok(trace.type === 'scatter' || trace.type === 'bar');
          assert.equal(trace.x.length, trace.y.length);
          assert.ok(trace.x.length > 0 && trace.x.length < 5000);
          assert.ok(trace.y.every(Number.isFinite), `nonfinite y in ${plot.title}`);
          assert.ok(trace.x.every(v => typeof v === 'string' || Number.isFinite(v)));
          if (Array.isArray(trace.marker?.color)) {
            assert.equal(trace.marker.color.length, trace.x.length);
            assert.ok(trace.marker.color.every(Number.isFinite));
          }
        }
      }
      for (const invariant of result.checks) assert.ok(invariant.passed, `${reproduction.id}/${seed}: ${invariant.name}: ${invariant.detail}`);
    }
    // Finite code spaces can map two seeds to the same secret; do not require injective seeding.
    assert.ok(new Set(outputs).size > 1, 'seeds must affect data, noise, training or oracle evidence');
  });
}

test('shootouts genuinely differ in learners, selected settings and plotted evaluations', () => {
  const joint = classificationReproductions[0].run(17), fixed = classificationReproductions[1].run(17);
  assert.notDeepEqual(joint.plots, fixed.plots);
  assert.match(String(joint.metrics.selection), /joint gamma\/lambda/);
  assert.match(String(fixed.metrics.selection), /median-distance/);
  assert.ok(joint.plots[0].traces[0].x.some(v => v === 'rbf SVM'));
  assert.ok(fixed.plots[0].traces[0].x.some(v => v === 'rbf L1 softmax'));
});

test('analytical softmax: balanced intercept-only data stays uniform with log(2) loss', () => {
  const fit = fitSoftmax([[0], [0], [0], [0]], [0, 1, 0, 1], .1, false);
  close(fit.probabilities([0])[0], .5);
  fit.history.forEach(v => close(v, Math.log(2)));
  assert.ok(fit.W.every(row => row.every(v => v === 0)));
});

test('proximal softmax objective descends for both penalties; L1 eliminates null features', () => {
  for (const l1 of [false, true]) {
    const fit = fitSoftmax([[-2, 0], [-1, 0], [1, 0], [2, 0]], [0, 0, 1, 1], .03, l1, 240);
    assert.ok(fit.history.slice(1).every((v, i) => v <= fit.history[i] + 1e-10));
    assert.equal(fit.predict([-3, 0]), 0); assert.equal(fit.predict([3, 0]), 1);
    assert.ok(fit.W.every(row => row[2] === 0));
  }
});

test('analytical hard-margin SVM fixture: nearest points +/-1 imply w=1, b=0', () => {
  const svm = fitBinarySvm([[-2], [-1], [1], [2]], [-1, -1, 1, 1], 10);
  close(svm.score([0]), 0, 1e-5); close(svm.score([3]), 3, 1e-5);
  close(svm.dualObjective, .5, 1e-6);
  close(svm.primalObjective, .5, 1e-5);
  close(svm.equalityResidual, 0);
  assert.equal(svm.supportCount, 2);
  assert.ok(svm.kktViolation < 1e-5);
});

test('RBF SMO separates XOR, while respecting dual box/equality constraints', () => {
  const X = [[-1, -1], [-1, 1], [1, -1], [1, 1]], y = [-1, 1, 1, -1];
  const svm = fitBinarySvm(X, y, 10, 'rbf', 1);
  X.forEach((x, i) => assert.equal(Math.sign(svm.score(x)), y[i]));
  close(svm.equalityResidual, 0);
  assert.ok(svm.alpha.every(a => a >= 0 && a <= 10));
});

test('analytical kernel ridge fixture: independently inverted two-by-two RBF system', () => {
  // gamma=log(2) gives K=[[1,.5],[.5,1]]. With lambda=.5,
  // inverse(K+lambda I)=[[.75,-.25],[-.25,.75]].
  const ridge = fitKernelRidge([[0], [1]], [0, 1], .5, 'rbf', Math.log(2));
  close(ridge.coefficients[0][0], .75); close(ridge.coefficients[0][1], -.25);
  close(ridge.coefficients[1][0], -.25); close(ridge.coefficients[1][1], .75);
  close(ridge.scores([0])[0], .625); close(ridge.scores([0])[1], .125);
  close(ridge.normalResidual, 0);
  assert.equal(ridge.predict([1]), 1);
});

test('analytical Gaussian NB fixture uses empirical priors, ML variances and additive smoothing', () => {
  const nb = fitGaussianNb([[-3], [-1], [1], [3]], [0, 0, 1, 1], .5);
  assert.deepEqual(nb.means, [[-2], [2]]);
  assert.deepEqual(nb.variance, [[1.5], [1.5]]);
  assert.deepEqual(nb.priors, [.5, .5]);
  close(nb.probabilities([0])[0], .5);
  close(nb.probabilities([1])[1], 1 / (1 + Math.exp(-8 / 3)));
});

test('analytical epsilon-SVR single observation has beta=y-epsilon, clipped to C', () => {
  const free = fitEpsilonSvr([[0]], [2], 3, .2);
  close(free.beta[0], 1.8); close(free.prediction([100]), 1.8); close(free.coordinateResidual, 0);
  const clipped = fitEpsilonSvr([[0]], [-2], 1, .2);
  close(clipped.beta[0], -1); close(clipped.prediction([0]), -1);
});

test('analytical CART fixture finds midpoint separating two pure groups', () => {
  const tree = fitCart([[-2], [-1], [1], [2]], [0, 0, 1, 1], 1, 1);
  close(tree.threshold!, 0); close(tree.impurity, .5); close(tree.gain!, .5);
  assert.equal(tree.feature, 0);
  assert.equal(predictCart(tree, [-10]), 0); assert.equal(predictCart(tree, [10]), 1);
  assert.equal(tree.left?.count, 2); assert.equal(tree.right?.count, 2);
});

test('analytical Gaussian LDA/QDA fixture: same covariance, midpoint posterior is one-half', () => {
  const X = [[-3, 0], [-1, 0], [-2, -1], [-2, 1], [1, 0], [3, 0], [2, -1], [2, 1]];
  for (const qda of [false, true]) {
    const fit = fitDiscriminant(X, [0, 0, 0, 0, 1, 1, 1, 1], qda, 0);
    close(fit.means[0][0], -2); close(fit.means[1][0], 2);
    close(fit.covariance[0][0][0], 2 / 3); close(fit.covariance[0][1][1], 2 / 3);
    close(fit.probabilities([0, .3])[0], .5);
    assert.equal(fit.predict([-1, 0]), 0); assert.equal(fit.predict([1, 0]), 1);
  }
});

test('QDA genuinely uses unequal class covariance, giving nonzero log-odds curvature', () => {
  const X = [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]];
  const y = [0, 0, 0, 0, 1, 1, 1, 1], qda = fitDiscriminant(X, y, true, 0), lda = fitDiscriminant(X, y, false, 0);
  close(qda.probabilities([0, 0])[0], .8);
  const odds = (x: number) => qda.scores([x, 0])[0] - qda.scores([x, 0])[1];
  close(odds(1) - 2 * odds(0) + odds(-1), -1.125);
  close(lda.probabilities([2, 0])[0], .5);
  assert.ok(qda.probabilities([2, 0])[0] < .5);
});

test('label RBM free-energy posterior matches explicit enumeration of hidden bit configurations', () => {
  const rbm: LabelRbm = { W: [[.3, -.7], [.8, .1]], hiddenBias: [.2, -.4], visibleBias: [.9, -.6],
    U: [[.4, -.2], [-.3, .7]], labelBias: [.1, -.2] };
  const v = [1, 0];
  const masses = [0, 1].map(c => {
    let mass = 0;
    for (const h of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      let negativeEnergy = rbm.labelBias[c] + v[0] * rbm.visibleBias[0] + v[1] * rbm.visibleBias[1];
      for (let j = 0; j < 2; j++) {
        negativeEnergy += h[j] * (rbm.hiddenBias[j] + rbm.U[c][j]);
        for (let i = 0; i < 2; i++) negativeEnergy += v[i] * rbm.W[i][j] * h[j];
      }
      mass += Math.exp(negativeEnergy);
    }
    return mass;
  });
  rbmClassProbabilities(rbm, v).forEach((p, c) => close(p, masses[c] / (masses[0] + masses[1])));
  const hp = rbmHiddenProbabilities(rbm, v, 0);
  close(hp[0], 1 / (1 + Math.exp(-(.2 + .3 + .4))));
});

test('RBM CD-1 training changes weights and top model has a real categorical visible label layer', () => {
  const X = [[1, 0], [1, 0], [0, 1], [0, 1]], labels = [0, 0, 1, 1];
  const untrained = fitRbm(X, 3, 18, undefined, 0);
  const trained = fitRbm(X, 3, 18, labels, 15);
  assert.notDeepEqual(trained.model.W, untrained.model.W);
  assert.equal(trained.model.U.length, 2); assert.equal(trained.model.U[0].length, 3);
  assert.ok(trained.conditionalLoss.at(-1)! < trained.conditionalLoss[0]);
  assert.ok(rbmClassProbabilities(trained.model, [1, 0])[0] > .5);
  assert.ok(rbmClassProbabilities(trained.model, [0, 1])[1] > .5);
});

test('CNN analytical convolution/pooling fixture uses shared filters and exact cell averaging', () => {
  const cnn: TinyCnn = { filters: [Array(9).fill(1)], bias: [0], head: [Array(4).fill(0), Array(4).fill(0)], headBias: [0, 0] };
  const forward = cnnForward(cnn, Array(36).fill(1));
  forward.conv[0].forEach(v => close(v, Math.tanh(9)));
  forward.pooled.forEach(v => close(v, Math.tanh(9)));
  forward.probabilities.forEach(v => close(v, .5));
});

test('CNN analytic backprop matches independent central finite differences for every parameter', () => {
  const model: TinyCnn = {
    filters: [[.1, -.2, .15, .12, .07, -.11, .13, -.09, .04]],
    bias: [.03], head: [[.2, -.1, .4, .3], [-.3, .2, .1, -.4]], headBias: [.1, -.1],
  };
  const image = Array.from({ length: 36 }, (_, i) => (i % 7) / 7);
  const grad = cnnGradient(model, image, 1), epsilon = 1e-5;
  const loss = () => -Math.log(cnnForward(model, image).probabilities[1]);
  for (const key of ['filters', 'head'] as const) for (let i = 0; i < model[key].length; i++) {
    for (let j = 0; j < model[key][i].length; j++) {
      const old = model[key][i][j];
      model[key][i][j] = old + epsilon; const above = loss();
      model[key][i][j] = old - epsilon; const below = loss(); model[key][i][j] = old;
      close(grad[key][i][j], (above - below) / (2 * epsilon), 2e-8);
    }
  }
  for (const key of ['bias', 'headBias'] as const) for (let j = 0; j < model[key].length; j++) {
    const old = model[key][j];
    model[key][j] = old + epsilon; const above = loss();
    model[key][j] = old - epsilon; const below = loss(); model[key][j] = old;
    close(grad[key][j], (above - below) / (2 * epsilon), 2e-8);
  }
});

test('analytical Hopfield energy and asynchronous retrieval fixture', () => {
  const W = [[0, 1], [1, 0]];
  close(hopfieldEnergy(W, [1, -1]), 1); close(hopfieldEnergy(W, [1, 1]), -1);
  const recall = recallHopfield(W, [1, -1]);
  assert.deepEqual(recall.state, [-1, -1]);
  assert.ok(recall.energies.slice(1).every((v, i) => v <= recall.energies[i]));
  const hebb = hopfieldWeights([[1, 1, -1]]);
  close(hebb[0][1], 1 / 3); close(hebb[0][2], -1 / 3); close(hebb[0][0], 0);
});

test('analytical Bayesian Hamming posterior eliminates inconsistent codes and renormalizes', () => {
  const codes = [[0, 0], [0, 1], [1, 0], [1, 1]];
  assert.equal(hamming([0, 0], [1, 0]), 1);
  const result = codePosterior(codes, [.25, .25, .25, .25], [0, 0], 1);
  close(result.evidence, .5);
  assert.deepEqual(result.posterior, [0, .5, .5, 0]);
  const decoded = codePosterior(codes, result.posterior, [0, 1], 0);
  assert.deepEqual(decoded.posterior, [0, 1, 0, 0]);
  assert.throws(() => codePosterior(codes, decoded.posterior, [0, 1], 2), /Impossible/);
});

test('independent exact QR/ridge fixture verifies regression coefficients and unpenalized intercept', () => {
  const design = [[1, -1], [1, 0], [1, 1]], y = [-1, 2, 5];
  const ols = linearFit(design, y, 0), ridge = linearFit(design, y, 2);
  close(ols.coefficients[0], 2); close(ols.coefficients[1], 3);
  close(ridge.coefficients[0], 2); close(ridge.coefficients[1], 1.5);
});
