function [yhat, f, probability] = svmlibPredict(model, Xtest)
% PMTK interface to libsvm
% model is returned by svmlibFit
%%
% libsvm requires that only specific fields be included in model - remove
% all others;

% This file is from pmtk3.googlecode.com


if isfield(model, 'libsvmFields')
    allowed = model.libsvmFields;
else
    allowed = {'Parameters', 'nr_class', 'totalSV', 'rho', 'Label', 'ProbA', ...
               'ProbB', 'nSV', 'sv_coef', 'SVs', 'sv_indices', 'ProbDensityMarks'};
end
remove = setdiff(fieldnames(model), allowed);
model  = rmfield(model, remove); 
%%
n = size(Xtest, 1);
options = '-b 0';
if exist('OCTAVE_VERSION', 'builtin'), options = [options ' -q']; end
evalc('[yhat, accuracy, f] = svmLibsvmBackend(''predict'', zeros(n, 1), double(Xtest), model, options);');
probability = [];
if nargout > 2
    if ~any(model.Parameters(1) == [0 1]) || isempty(model.ProbA) || isempty(model.ProbB)
        error('PMTK:SvmProbabilityUnavailable', 'Class probabilities require SVC training with estProb=1 (or LIBSVM -b 1). SVR exposes its native ProbA noise scale instead.');
    end
    options = '-b 1';
    if exist('OCTAVE_VERSION', 'builtin'), options = [options ' -q']; end
    evalc('[probability_labels, accuracy, probability] = svmLibsvmBackend(''predict'', zeros(n, 1), double(Xtest), model, options);');
end
end
