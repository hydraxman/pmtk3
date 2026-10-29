function demo_lab_residual_support()
% Diagnostic only; never represented as execution of an original demo.
root = getenv('DEMO_LAB_REPO');
addpath(fullfile(root, 'data-tools'));
report = test_residual_support(root);
filename = fullfile(getenv('DEMO_LAB_ATTEMPT'), 'residual-support-tests.json');
fid = fopen(filename, 'w');
if fid < 0, error('demo_lab:ResidualTest', 'Cannot write residual-support diagnostic'); end
fprintf(fid, '%s\n', jsonencode(report));
fclose(fid);
end
