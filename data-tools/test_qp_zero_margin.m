function test_qp_zero_margin(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
pkg load optim;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
model.kernelFn = @kernelLinear;
model.kernelParam = 1;
model.X = [-1; 1];
model.y = [-1; 1];
model.alpha = [0.5; 0.5];
model.bias = 0;
[labels, decisions] = svmQPclassifPredict(model, [-1;0;1]);
assert(isequal(decisions, [-1;0;1]));
assert(isequal(labels, [-1;-1;1]));
model.alpha(1) = NaN;
rejected = false;
try
    svmQPclassifPredict(model, 1);
catch err
    assert(strcmp(err.identifier, 'PMTK:SvmNonfiniteDecision'));
    rejected = true;
end
assert(rejected);
model = svmFit([-2;-1;1;2], [10;10;20;20], ...
    'C', 10, 'fitFn', @svmQPclassifFit, 'kernel', 'linear', 'standardizeX', false);
assert(isequal(svmPredict(model, [-1;1]), [10;20]));
model.alpha(:) = 0;
model.bias = 0;
[labels, decisions] = svmPredict(model, [-1;0;1]);
assert(isequal(labels, [10;10;10]) && isequal(decisions, zeros(3,1)));
fprintf('QP SVM margins, exact ties, original label support and nonfinite errors passed.\n');
end
