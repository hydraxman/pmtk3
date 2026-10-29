function test_quantile(root)
addpath(fullfile(root, 'matlabTools', 'stats'));
actual = quantilePMTK([4 1 3 2], [0 0.25 0.5 0.75 1]);
assert(max(abs(actual - [1; 1.5; 2.5; 3.5; 4])) < 1e-12);
assert(all(quantilePMTK(7, [0 0.5 1]) == 7));
for invalid = {-0.1, 1.1, NaN}
    caught = false;
    try
        quantilePMTK([1 2 3], invalid{1});
    catch err
        caught = strcmp(err.identifier, 'quantilePMTK:invalidProbabilities');
    end
    assert(caught);
end
fprintf('PMTK quantile interpolation and boundary tests passed.\n');
end
