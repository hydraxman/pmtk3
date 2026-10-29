function test_glmnet_demo_options(repo)
addpath(fullfile(repo, 'matlabTools', 'stats'));
addpath(fullfile(repo, 'pmtksupportCopy', 'packages', 'glmnet-matlab'));
original = glmnetSet();
lastwarn('');
options = glmnetDemoOptions();
[~, warningId] = lastwarn;
if exist('OCTAVE_VERSION', 'builtin')
    assert(options.octave_max_passes == 100000);
    assert(strcmp(warningId, 'PMTK:GlmnetDemoBudget'));
    if isfield(original, 'octave_max_passes')
        options.octave_max_passes = original.octave_max_passes;
    else
        options = rmfield(options, 'octave_max_passes');
    end
end
assert(isequaln(options, original));
fprintf('GLMnet demo options preserve all other library defaults.\n');
end
