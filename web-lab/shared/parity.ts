import { parityFixtures, sum, type AdapterId } from './numerics.js';

type Profile = ReturnType<typeof parityFixtures>;
export interface OriginalNumericalReference {
  engine: string;
  scope: string;
  checks_passed: number;
  beta: Profile['beta'];
  regression: Profile['regression'];
  pca: Pick<Profile['pca'], 'points' | 'covarianceConvention' | 'basis' | 'eigenvalues' | 'reconstruction'>;
  hmm: Pick<Profile['hmm'], 'initial' | 'transition' | 'emission' | 'observationsZeroBased' | 'gamma' | 'logLikelihood'>;
  sprinkler: Profile['sprinkler'];
  mixture: Pick<Profile['mixture'], 'data' | 'initial' | 'means' | 'variances' | 'weights' | 'logLikelihoodHistory'>;
}
export interface ModelParity {
  model: AdapterId;
  originalFunction: string;
  passed: boolean;
  numericComparisons: number;
  maxAbsoluteError: number;
  absoluteTolerance: number;
  failures: string[];
}
export const parityScope = 'Six fixed fixtures only; not verification of all PMTK3 demos or arbitrary parameter regimes.';

/** Compares independent TS calculations to the supplied original-engine oracle.
 * Input identity and array shapes are checked, not just output prefixes.
 */
export function checkNumericalParity(reference: OriginalNumericalReference, actual = parityFixtures()) {
  const globalErrors: string[] = [];
  if (!reference || typeof reference.engine !== 'string' || !reference.engine) globalErrors.push('Reference engine metadata is missing');
  if (reference?.checks_passed !== 6) globalErrors.push('Original reference does not record six passed fixed-fixture checks');
  const models: ModelParity[] = [];
  function model(id: AdapterId, originalFunction: string, tolerance: number,
    checks: (compare: (a: unknown, b: unknown, label: string, tolerance?: number) => void) => void) {
    const row: ModelParity = { model: id, originalFunction, passed: false,
      numericComparisons: 0, maxAbsoluteError: 0, absoluteTolerance: tolerance, failures: [] };
    function compare(a: unknown, b: unknown, label: string, tol = tolerance): void {
      if (typeof a === 'number' && typeof b === 'number') {
        row.numericComparisons++;
        if (!Number.isFinite(a) || !Number.isFinite(b)) { row.failures.push(`${label}: nonfinite value`); return; }
        const error = Math.abs(a - b);
        row.maxAbsoluteError = Math.max(row.maxAbsoluteError, error);
        if (error > tol) row.failures.push(`${label}: TS=${a}, reference=${b}, |difference|=${error}, tolerance=${tol}`);
      } else if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) { row.failures.push(`${label}: shape mismatch (${a.length} vs ${b.length})`); return; }
        a.forEach((value, i) => compare(value, b[i], `${label}[${i}]`, tol));
      } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        const keys = Object.keys(a).sort(), other = Object.keys(b).sort();
        if (keys.join('\0') !== other.join('\0')) { row.failures.push(`${label}: object shape mismatch`); return; }
        for (const key of keys) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${label}.${key}`, tol);
      } else if (a !== b || a === undefined) {
        row.failures.push(`${label}: missing field, type mismatch, or different fixed input`);
      }
    }
    try { checks(compare); }
    catch { row.failures.push('Malformed or missing original reference fields'); }
    row.passed = !row.failures.length && row.numericComparisons > 0;
    models.push(row);
  }
  model('beta', 'betaLogprob', 1e-10, compare => {
    compare(actual.beta.prior, reference.beta.prior, 'prior', 0);
    compare(actual.beta.observations, reference.beta.observations, 'observations', 0);
    compare(actual.beta.x, reference.beta.x, 'density evaluation points', 0);
    compare(actual.beta.posterior, reference.beta.posterior, 'posterior');
    compare(actual.beta.mean, reference.beta.mean, 'mean');
    compare(actual.beta.density, reference.beta.density, 'density');
  });
  model('regression', 'linregFit', 1e-10, compare => {
    compare(actual.regression.x, reference.regression.x, 'x', 0);
    compare(actual.regression.y, reference.regression.y, 'y', 0);
    compare(actual.regression.ridgeLambda, reference.regression.ridgeLambda, 'lambda', 0);
    compare(actual.regression.ols, reference.regression.ols, 'OLS coefficients');
    compare(actual.regression.ridge, reference.regression.ridge, 'ridge coefficients (bias unpenalized)');
  });
  model('pca', 'pcaPmtk', 1e-10, compare => {
    compare(actual.pca.points, reference.pca.points, 'points', 0);
    if (!/population/i.test(reference.pca.covarianceConvention)) throw new Error('Expected population covariance');
    compare(actual.pca.eigenvalues, reference.pca.eigenvalues, 'population eigenvalues');
    const projector = reference.pca.basis.map(v => reference.pca.basis.map(w => v * w));
    compare(actual.pca.projector, projector, 'rank-one projector (sign invariant)');
    compare(actual.pca.reconstruction, reference.pca.reconstruction, 'reconstruction');
  });
  model('em', 'mixGaussFit (MLE, prior=none, mixPrior=none)', 1e-10, compare => {
    compare(actual.mixture.data, reference.mixture.data, 'data', 0);
    compare(actual.mixture.initial, reference.mixture.initial, 'initial parameters', 0);
    compare(actual.mixture.means, reference.mixture.means, 'means');
    compare(actual.mixture.variances, reference.mixture.variances, 'variances');
    compare(actual.mixture.weights, reference.mixture.weights, 'weights');
    compare(actual.mixture.logLikelihoodHistory, reference.mixture.logLikelihoodHistory, 'likelihood progression');
    compare(actual.mixture.training.converged, true, 'convergence within maxIter=25');
    compare(actual.mixture.training.convTol, 1e-10, 'relative convergence tolerance', 0);
  });
  model('hmm', 'hmmFwdBack', 1e-12, compare => {
    compare(actual.hmm.initial, reference.hmm.initial, 'initial distribution', 0);
    compare(actual.hmm.transition, reference.hmm.transition, 'from-state/to-state transition matrix', 0);
    compare(actual.hmm.emission, reference.hmm.emission, 'emission matrix', 0);
    compare(actual.hmm.observationsZeroBased, reference.hmm.observationsZeroBased, 'zero-based observations', 0);
    compare(actual.hmm.gamma, reference.hmm.gamma, 'gamma (state × time)');
    compare(actual.hmm.logLikelihood, reference.hmm.logLikelihood, 'sequence log-likelihood');
    const transposed = reference.hmm.observationsZeroBased.map((_, t) => reference.hmm.initial.map((_, s) => reference.hmm.gamma[s][t]));
    compare(actual.hmm.marginals, transposed, 'marginals (time × state)');
    actual.hmm.gamma[0].forEach((_, t) => compare(sum(actual.hmm.gamma.map(row => row[t])), 1, `gamma normalization at t=${t}`));
  });
  model('sprinkler', 'tabularFactorMultiply', 1e-12, compare => {
    compare(actual.sprinkler.wet, reference.sprinkler.wet, 'P(wet)');
    compare(actual.sprinkler.rainGivenWet, reference.sprinkler.rainGivenWet, 'P(rain | wet)');
  });
  return {
    passed: !globalErrors.length && models.every(row => row.passed),
    scope: parityScope,
    reference: 'demo-results/numerical-reference.json',
    referenceEngine: reference?.engine ?? 'unknown',
    referenceChecksPassed: reference?.checks_passed ?? 0,
    checksPassed: models.filter(row => row.passed).length,
    totalChecks: models.length,
    models,
    errors: globalErrors,
    note: 'Compares persisted original-engine outputs to independent TS calculations; this check does not execute Octave.',
  };
}
