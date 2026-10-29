function test_linear_compat(root)
warning('off', 'Octave:shadowed-function');
pkg load statistics;
pkg load optim;
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
x = (0:3)';
y = [1;3;5;9];
expected = 1-1.2/35;
assert(abs(regressionRSquared(y, x)-expected) < 1e-12);
assert(abs(regressionRSquared(uint8(y), single(x))-expected) < 1e-12);
assert(abs(regressionRSquared(10+4*y, 3*x-7)-expected) < 1e-12);
assert(abs(regressionRSquared(2+3*x, x)-1) < 1e-12);
assert(abs(regressionRSquared(y, ones(4,1))) < 1e-12);
assert(isnan(regressionRSquared(ones(4,1), x)));
rejected = false;
try
    regressionRSquared([1;NaN], [0;1]);
catch err
    assert(strcmp(err.identifier, 'PMTK:InvalidRegressionSamples'));
    rejected = true;
end
assert(rejected);
model = linregRobustLaplaceFitLinprog(zeros(4,0), [0;0;0;10]);
assert(abs(model.w0) < 1e-8 && isempty(model.w));
x = (-2:2)';
y = 1+2*x;
y(end) = 20;
model = linregRobustLaplaceFitLinprog(x, y);
assert(abs(model.w0-1) < 1e-8 && abs(model.w-2) < 1e-8);
assert(abs(sum(abs(y-(model.w0+x*model.w)))-15) < 1e-8);
fprintf('OLS intercept R-squared, affine invariance, invalid inputs and exact LAD optima passed.\n');
end
