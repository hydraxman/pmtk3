function test_legacy_fa(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
setSeed(4);
labels = [1 1; 1 2; 2 1; 2 2; 3 1; 3 2];
[model, history] = catFAfit(labels, [], 1, 'maxIter', 3, 'verbose', false);
assert(all(isfinite(history)));
assert(isequal(model.nClass(:)', [3 2]));
assert(all(isfinite(model.params.beta(:))));
[continuous, history] = catFAfit([], randn(12, 3), 1, 'maxIter', 3, 'verbose', false);
assert(all(isfinite(history)));
assert(all(isfinite(continuous.params.beta(:))));
labels(1, 1) = NaN;
observations = randn(6, 2);
observations(2, 1) = NaN;
[missing, history] = catFAfit(labels, observations, 1, 'nClass', [3 2], ...
    'maxIter', 3, 'verbose', false);
assert(all(isfinite(history)));
assert(all(isfinite(missing.params.beta(:))));
[predictedLabels, predictedValues] = catFApredictMissing(missing, labels, observations);
assert(all(isfinite(predictedLabels(:))));
assert(all(isfinite(predictedValues(:))));
probabilitySums = sum(predictedLabels, 3);
assert(max(abs(probabilitySums(:)-1)) < 1e-10);
fprintf('Recovered categorical and continuous factor-analysis smoke tests passed.\n');
end
