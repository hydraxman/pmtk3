function test_optional_native(root)
warning('off', 'Octave:shadowed-function');
warning('off', 'Octave:possible-matlab-short-circuit-operator');
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
left = [1 2 3; 4 5 6];
right = [3 1; 2 4; 1 5];
expected = zeros(2);
for i = 1:2
    for j = 1:2
        expected(i,j) = max(left(i,:).*right(:,j)');
    end
end
assert(isequal(max_mult(left, right), expected));
assert(isequal(max_mult(-left, right), [-3 -1; -6 -4]));
assert(isequal(size(max_mult(zeros(0,3), right)), [0 2]));
assert(isequal(size(max_mult(left, zeros(3,0))), [2 0]));
if exist('max_mult', 'file') ~= 3
    assert(isnan(max_mult([NaN 2], [1;3])));
    assert(max_mult([2 NaN], [3;1]) == 6);
    rejected = false;
    try
        max_mult(zeros(2,0), zeros(0,3));
    catch err
        assert(strcmp(err.identifier, 'max_mult:Dimensions'));
        rejected = true;
    end
    assert(rejected);
end
params = struct('verbose', 0, 'order', -1, 'maxIter', 1000, ...
    'optTol', 1e-12, 'threshold', 1e-12);
solution = L1GeneralProjection(@quadratic, zeros(3,1), [0.2;0.3;3], params);
assert(norm(solution-[2.8;-1.85;0]) < 1e-5);
options = foptions;
options(1) = 0;
options(2) = 1e-8;
options(3) = 1e-12;
options(14) = 500;
target = [2 -3];
solution = scg(@(x)sum((x-target).^2), [0 0], options, @(x)2*(x-target));
assert(norm(solution-target) < 1e-6);
solution = scg('sumsq', [2 -3], options, '@(x) 2*x');
assert(norm(solution) < 1e-6);
expression = pmtkNetlabFunction('sum((x-P1).^2)', 1);
assert(feval(expression, [1 2], 2) == 1);
named = pmtkNetlabFunction('sumsq', 0);
assert(feval(named, [2 -3]) == 13);
callable = @(x)sum(x.^2);
assert(isequal(pmtkNetlabFunction(callable, 0), callable));
rejected = false;
try
    pmtkNetlabFunction(42, 0);
catch err
    assert(strcmp(err.identifier, 'PMTK:InvalidNetlabFunction'));
    rejected = true;
end
assert(rejected);
for solver = {@conjgrad, @quasinew}
    solution = feval(solver{1}, 'sumsq', [2 -3], options, '@(x)2*x');
    assert(norm(solution) < 1e-5);
end
options(7) = 5;
options(14) = 30;
options(18) = 0.1;
hmc('state', 42);
[samples, energies] = hmc('sumsq', [0 0], options, '@(x)2*x');
hmc('state', 42);
[matched, matchedEnergies] = hmc(@sumsq, [0 0], options, @(x)2*x);
assert(isequal(samples, matched) && isequal(energies, matchedEnergies));
assert(isequal(size(samples), [30 2]));
assert(max(abs(energies-sum(samples.^2, 2))) < 1e-12);
rand('state', 42);
randn('state', 42);
[samples, energies] = metrop('sumsq', [0 0], options);
assert(isequal(size(samples), [30 2]));
assert(max(abs(energies-sum(samples.^2, 2))) < 1e-12);
fprintf('Max-times, L1 optimum, callable/expression Netlab optimizers and sampler energy tests passed.\n');
end

function [value, gradient, hessian] = quadratic(x)
hessian = diag([1 2 4]);
delta = x-[3;-2;0.4];
value = 0.5*delta'*hessian*delta;
gradient = hessian*delta;
end
