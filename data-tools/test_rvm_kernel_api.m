function test_rvm_kernel_api(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
x = [-4;-3;-2;-1;1;2;3;4];
y = [10;10;10;10;20;20;20;20];
model = rvmFit(x, y, 'kernelFn', @kernelLinear);
[labels, probabilities] = rvmPredict(model, [-3;3]);
assert(isequal(labels, [10;20]));
manual = sigmoid(([-3;3]*x')*model.w);
assert(max(abs(probabilities-manual)) < 1e-12);
assert(isequal(model.preproc.basis, x));
gamma = 0.7;
kernel = @(X1,X2) kernelRbfGamma(X1,X2,gamma);
model = rvmFit(x, y, 'kernelFn', kernel);
[labels, probabilities] = rvmPredict(model, [-3;3]);
manual = sigmoid(kernel([-3;3], x)*model.w);
assert(isequal(labels, [10;20]));
assert(max(abs(probabilities-manual)) < 1e-12);
fprintf('Current RVM named-kernel API, train/test Gram matrices, probabilities and label support passed.\n');
end
