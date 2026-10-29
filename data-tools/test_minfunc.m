function test_minfunc(root)
warning('off', 'Octave:shadowed-function');
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
options = struct('display', 'off', 'optTol', 1e-10, 'progTol', 1e-16, 'maxIter', 100);
for method = {'lbfgs', 'newton'}
    options.Method = method{1};
    [solution, objective] = minFunc(@quadratic, zeros(3,1), options);
    assert(norm(solution-[1;-2;3]) < 1e-7, ...
        sprintf('%s solution error: %g; objective: %g', method{1}, norm(solution-[1;-2;3]), objective));
    assert(objective < 1e-14);
end
if exist('lbfgsC', 'file') ~= 3
    options.Method = 'lbfgs';
    options.useMex = true;
    rejected = false;
    try
        minFunc(@quadratic, zeros(3,1), options);
    catch err
        assert(~isempty(strfind(err.message, 'lbfgsC')));
        rejected = true;
    end
    assert(rejected);
end
fprintf('Optional-native minFunc L-BFGS/Newton convergence and explicit-override tests passed.\n');
end

function [value, gradient, hessian] = quadratic(x)
hessian = diag([1 4 10]);
delta = x-[1;-2;3];
value = 0.5*delta'*hessian*delta;
gradient = hessian*delta;
end
