function test_legacy_helpers(root)
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(fullfile(root, 'toolbox', 'Algorithms', 'variableSelection', 'lassoExtra'));
path = [0 0; 0 1; 1 2];
weights = interpolateLarsWeights(path, 0:5, eye(2), [1; 2]);
expected = [1 2; 0.5 1.5; 0 1; 0 0.5; 0 0; 0 0];
assert(max(abs(weights(:) - expected(:))) < 1e-12);
output = evalc('latextable([1 2; 3 4], ''horiz'', {''A'', ''B''}, ''vline'', [0 1 NaN]);');
assert(~isempty(strfind(output, '\begin{tabular}{|c|c|}')));
assert(~isempty(strfind(output, 'A & B \\')));
assert(~isempty(strfind(output, '1.0 & 2.0 \\')));
fprintf('LARS interpolation and LaTeX table formatting tests passed.\n');
end
