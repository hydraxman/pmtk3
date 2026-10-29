function test_kde(root)
addpath(genpath(fullfile(root, 'matlabTools')));
setSeed(8);
samples = randn(500, 1);
[density, grid, bandwidth] = ksdensityPMTK(samples);
assert(isrow(density) && isrow(grid));
assert(numel(density) == numel(grid));
assert(bandwidth > 0 && isfinite(bandwidth));
assert(all(isfinite(density)) && min(density) > -1e-10);
assert(abs(trapz(grid, density) - 1) < 0.02);
[shiftedDensity, shiftedGrid, shiftedBandwidth] = ksdensityPMTK(samples + 5);
assert(max(abs(shiftedGrid - grid - 5)) < 1e-10);
assert(max(abs(shiftedDensity - density)) < 1e-8);
assert(abs(shiftedBandwidth - bandwidth) < 1e-10);
caught = false;
try
    ksdensityPMTK([1 NaN 2]);
catch err
    caught = strcmp(err.identifier, 'ksdensityPMTK:invalidSamples');
end
assert(caught);
fprintf('Portable KDE normalization, translation and invalid-input tests passed.\n');
end
