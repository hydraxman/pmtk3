function verify_models(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(fullfile(root, 'pmtksupportCopy', 'packages', 'lightspeed2.3'));

reference.engine = version();
reference.scope = 'Fixed analytical fixtures, not a proof of correctness for all demos';
reference.beta.prior = [0.5 0.5];
reference.beta.observations = [1 0 1 1 0 1];
a = 0.5 + sum(reference.beta.observations);
b = 0.5 + sum(1 - reference.beta.observations);
reference.beta.posterior = [a b];
reference.beta.mean = a / (a + b);
reference.beta.x = [0.2 0.5 0.8];
reference.beta.density = exp(betaLogprob(a, b, reference.beta.x));
assert(max(abs(reference.beta.density - betapdf(reference.beta.x, a, b))) < 1e-12);

x = [-2; -1; 0; 1; 2];
y = [-2.9; -1.1; 1; 3.1; 4.9];
ols = linregFit(x, y);
ridge = linregFit(x, y, 'lambda', 2);
reference.regression.x = x;
reference.regression.y = y;
reference.regression.ols = ols.w;
reference.regression.ridgeLambda = 2;
reference.regression.ridge = ridge.w;
assert(max(abs(ols.w - [1; 1.98])) < 1e-12);
assert(max(abs(ridge.w - [1; 1.65])) < 1e-12);

points = [-2 -1; -1 -0.5; 0 0; 1 0.5; 2 1];
[basis, scores, eigenvalues, reconstructed, mu] = pcaPmtk(points, 1);
reference.pca.points = points;
reference.pca.covarianceConvention = 'population, divide by N';
reference.pca.basis = basis;
reference.pca.eigenvalues = eigenvalues;
reference.pca.reconstruction = reconstructed;
assert(max(abs(eigenvalues(:) - [2.5; 0])) < 1e-12);
assert(max(abs(reconstructed(:) - points(:))) < 1e-12);

initial = [0.6 0.4];
transition = [0.7 0.3; 0.4 0.6];
emission = [0.5 0.5; 0.1 0.9];
observations = [1 2 1];
soft = emission(:, observations);
[gamma, alpha, beta, loglik] = hmmFwdBack(initial, transition, soft);
brute = zeros(2, 3);
likelihood = 0;
for s1 = 1:2
    for s2 = 1:2
        for s3 = 1:2
            p = initial(s1) * soft(s1, 1) * transition(s1, s2) ...
                * soft(s2, 2) * transition(s2, s3) * soft(s3, 3);
            likelihood = likelihood + p;
            brute(s1, 1) = brute(s1, 1) + p;
            brute(s2, 2) = brute(s2, 2) + p;
            brute(s3, 3) = brute(s3, 3) + p;
        end
    end
end
assert(max(abs(gamma(:) - brute(:) / likelihood)) < 1e-12);
assert(abs(loglik - log(likelihood)) < 1e-12);
reference.hmm.initial = initial;
reference.hmm.transition = transition;
reference.hmm.emission = emission;
reference.hmm.observationsZeroBased = observations - 1;
reference.hmm.gamma = gamma;
reference.hmm.logLikelihood = loglik;

cpdC = reshape([0.5 0.5], 2, 1);
cpdR = reshape([0.8 0.2 0.2 0.8], 2, 2);
cpdS = reshape([0.5 0.9 0.5 0.1], 2, 2);
cpdW = reshape([1 0.1 0.1 0.01 0 0.9 0.9 0.99], 2, 2, 2);
factors = {tabularFactorCreate(cpdC, 1), tabularFactorCreate(cpdS, [1 2]), ...
    tabularFactorCreate(cpdR, [1 3]), tabularFactorCreate(cpdW, [2 3 4])};
joint = tabularFactorMultiply(factors);
table = joint.T;
assert(abs(sum(table(:)) - 1) < 1e-12);
wet = table(:, :, :, 2);
rainWet = table(:, :, 2, 2);
reference.sprinkler.wet = sum(wet(:));
reference.sprinkler.rainGivenWet = sum(rainWet(:)) / sum(wet(:));
assert(abs(reference.sprinkler.wet - 0.6471) < 1e-12);
assert(abs(reference.sprinkler.rainGivenWet - 0.4581 / 0.6471) < 1e-12);

data = [-3; -2.5; -2; -1.5; 1.5; 2; 2.5; 3];
init.mu = [-2 2];
init.Sigma = reshape([1 1], 1, 1, 2);
init.mixWeight = [0.5 0.5];
[mixture, history] = mixGaussFit(data, 2, 'initParams', init, 'prior', 'none', 'mixPrior', 'none', ...
    'maxIter', 25, 'convTol', 1e-10, 'verbose', false);
assert(all(diff(history) >= -1e-8));
assert(max(abs(sort(mixture.cpd.mu) - [-2.25 2.25])) < 1e-5);
reference.mixture.data = data;
reference.mixture.initial = init;
reference.mixture.means = mixture.cpd.mu;
reference.mixture.variances = squeeze(mixture.cpd.Sigma);
reference.mixture.weights = mixture.mixWeight;
reference.mixture.logLikelihoodHistory = history;
setSeed(7);
[restarted, restartHistory] = mixGaussFit(data, 2, 'initParams', init, ...
    'nRandomRestarts', 2, 'maxIter', 15, 'verbose', false);
assert(all(isfinite(restarted.cpd.mu(:))));
assert(all(isfinite(restartHistory)));
reference.checks_passed = 6;

output = fullfile(root, 'demo-results', 'numerical-reference.json');
fid = fopen(output, 'w');
if fid < 0
    error('verify_models:output', 'Cannot open numerical-reference.json');
end
cleanup = onCleanup(@() fclose(fid));
fprintf(fid, '%s\n', jsonencode(reference));
fprintf('Six original numerical model fixtures passed. Reference: %s\n', output);
end
