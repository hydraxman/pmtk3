import test from 'node:test';
import assert from 'node:assert/strict';
import { parityFixtures } from '../shared/numerics.js';
import { checkNumericalParity, type OriginalNumericalReference } from '../shared/parity.js';

function fixture(): OriginalNumericalReference {
  const actual = parityFixtures();
  return { ...actual, engine: 'synthetic oracle for comparator unit tests',
    scope: 'Comparator behavior only; not an original-engine result', checks_passed: 6,
    pca: { ...actual.pca, basis: actual.pca.basis.map(v => -v) } };
}
test('parity comparator accepts PCA sign flips, and explicitly limits its verdict to fixed fixtures', () => {
  const report = checkNumericalParity(fixture());
  assert.equal(report.passed, true);
  assert.equal(report.checksPassed, 6);
  assert.equal(report.totalChecks, 6);
  assert.match(report.scope, /not verification of all PMTK3/);
  assert.ok(report.models.every(model => model.numericComparisons > 0));
});
test('HMM parity rejects transposed gamma, subtly wrong gamma, and different transition inputs', () => {
  const transposed = fixture();
  transposed.hmm.gamma = transposed.hmm.gamma[0].map((_, t) => transposed.hmm.gamma.map(row => row[t]));
  const shapeReport = checkNumericalParity(transposed);
  assert.equal(shapeReport.passed, false);
  assert.ok(shapeReport.models.find(model => model.model === 'hmm')!.failures.some(f => f.includes('shape mismatch')));
  const perturbed = fixture();
  perturbed.hmm.gamma[0][0] += 1e-8;
  perturbed.hmm.gamma[1][0] -= 1e-8; // Still normalized: direct original gamma comparison must catch this.
  assert.equal(checkNumericalParity(perturbed).models.find(model => model.model === 'hmm')!.passed, false);
  const otherInputs = fixture();
  otherInputs.hmm.transition[0] = [.69, .31];
  assert.equal(checkNumericalParity(otherInputs).passed, false);
});
test('parity comparator rejects incomplete original checks, nonfinite output, and truncated arrays', () => {
  const incomplete = fixture();
  incomplete.checks_passed = 5;
  assert.equal(checkNumericalParity(incomplete).passed, false);
  const invalid = fixture();
  invalid.regression.ridge[0] = NaN;
  const nonfinite = checkNumericalParity(invalid);
  assert.equal(nonfinite.passed, false);
  assert.ok(nonfinite.models.find(model => model.model === 'regression')!.failures.some(f => f.includes('nonfinite')));
  const truncated = fixture();
  truncated.beta.density.pop();
  assert.equal(checkNumericalParity(truncated).passed, false);
});
