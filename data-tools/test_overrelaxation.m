function test_overrelaxation(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
data = [-2 -1; -2.2 -1.3; -1.5 -1; -1.8 -0.5; ...
    2 1; 2.2 1.3; 1.5 1; 1.8 0.5];
initial.mu = [-2 2; -1 1];
initial.Sigma = cat(3, eye(2), eye(2));
initial.mixWeight = [0.4 0.6];
for factor = [1 2 realmax]
    [model, history] = mixGaussFitOverrelaxedEM(data, 2, factor, ...
        'initParams', initial, 'maxIter', 6, 'convTol', 0);
    assert(all(isfinite(history)));
    assert(all(diff(history) >= -1e-8));
    assert(abs(sum(model.mixWeight)-1) < 1e-12);
    assert(all(isfinite(model.cpd.Sigma(:))));
    for k = 1:2
        [~, failure] = chol(model.cpd.Sigma(:,:,k));
        assert(failure == 0);
    end
end
setSeed(8);
[model, history] = mixGaussFitOverrelaxedEM(data, 2, 2, ...
    'restartNum', 2, 'maxIter', 3);
assert(all(isfinite(history)) && all(isfinite(model.cpd.mu(:))));
fprintf('Over-relaxed EM finite candidates, monotone likelihood, adaptive rejection and restart tests passed.\n');
end
