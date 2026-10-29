function model = svmlibLinearFit(X, y, C, ignore1, kernel, options)
% PMTK interface to svm liblinear
% Supports only classification with a linear kernel.
% Download liblinear from 
% http://www.csie.ntu.edu.tw/~cjlin/liblinear/#download

% This file is from pmtk3.googlecode.com

y = colvec(double(y));
if ~isnumeric(X) || ~isreal(X) || any(~isfinite(nonzeros(X))) || ...
        ~isscalar(C) || ~isreal(C) || ~isfinite(C) || C <= 0 || ...
        any(~isfinite(y)) || any(y ~= round(y)) || numel(unique(y)) < 2
    error('PMTK:LiblinearInput', 'Classification requires finite features, integer labels in at least two classes and positive finite C.');
end
if nargin >= 5 && ~isempty(kernel) && (~ischar(kernel) || ~strcmpi(kernel,'linear'))
    error('PMTK:LiblinearKernel', 'LIBLINEAR implements a linear feature model; nonlinear kernels are not substituted.');
end
if nargin < 6 || isempty(options)
    if nunique(y) > 2
        typeSwitch = '-s 4';
    else
        typeSwitch = '';
    end
    Cswitch = sprintf('-c %.17g', C);
    options = sprintf('%s %s', Cswitch, typeSwitch);
        
end
if ~ischar(options)
    error('PMTK:LiblinearOptions', 'The existing LIBLINEAR options argument must be a character string.');
end
if ~isempty(regexp(options,'(^|\s)-(v|C)(\s|$)','once'))
    error('PMTK:LiblinearOptions', 'This fit interface returns a model, not native CV/parameter-search scalars.');
end
solver = regexp(options,'(?:^|\s)-s\s+([0-9]+)(?:\s|$)','tokens','once');
if ~isempty(solver) && ~ismember(str2double(solver{1}),0:7)
    error('PMTK:LiblinearSolver', 'This PMTK interface supports LIBLINEAR classification solvers only.');
end
model = svmLiblinearBackend('train',y,sparse(double(X)),options);
if ~isstruct(model) || ~all(isfield(model,{'Parameters','nr_class','nr_feature','bias','Label','w'}))
    error('PMTK:LiblinearNativeFailure', 'Native LIBLINEAR did not return a classification model.');
end
model.liblinearFields = fieldnames(model);
model.liblinearProvider = svmLiblinearBackend('info');
model.liblinearOptions = options;
model.liblinearDecisionLabels = sort(unique(y))';
model.linearWeights = model.w(:,1:model.nr_feature);
model.linearIntercept = zeros(size(model.w,1),1);
if model.bias >= 0
    model.linearIntercept = model.bias*model.w(:,end);
end
model.C = C;
model.fitEngine = mfilename();
end
