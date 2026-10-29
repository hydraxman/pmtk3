function options = glmnetDemoOptions()
% Explicit demo budget for the newer Octave GLMnet core; MATLAB is unchanged.
options = glmnetSet();
if exist('OCTAVE_VERSION', 'builtin')
    options.octave_max_passes = 100000;
    warning('PMTK:GlmnetDemoBudget', ...
        ['Configured Octave GLMnet demo budget: 100000 whole-path passes. ' ...
         'This is not the legacy per-lambda maxit unit. Native automatic ' ...
         'path stopping is preserved; fit.octave_budget records actual use.']);
end
end
