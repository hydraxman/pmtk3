function [yhat, f, probability] = svmPredict(model, Xtest)
% Return svm predictions.
% model is a struct as returned by svmFit()
% Xtest(i, :) is the ith case. 
% f  is the signed distance to separating hyperplane
% LIBSVM f contains native pairwise decision values (not normalized distance).
% Optional probability columns follow model.ySupport, requiring estProb=1.

% This file is from pmtk3.googlecode.com


if isfield(model, 'standardizeX') && model.standardizeX
    if isfield(model, 'svmPreprocess')
        Xtest = bsxfun(@minus, Xtest, model.svmPreprocess.center);
        Xtest = mkUnitVariance(Xtest, model.svmPreprocess.scale);
    else
        Xtest = mkUnitVariance(centerCols(Xtest)); % serialized legacy models
    end
end
if isfield(model, 'rescaleX') && model.rescaleX
   Xtest = rescaleData(Xtest, -1, 1, model.minx, model.rangex); 
end
switch model.fitEngine
    case 'svmlibFit'
        predictFn = @svmlibPredict;
    case 'svmlibLinearFit'
        predictFn = @svmlibLinearPredict;
    case 'svmlightFit'
        predictFn = @svmlightPredict;
    case 'svmQPclassifFit'
        predictFn = @svmQPclassifPredict;
    case 'svmQPregFit'
        predictFn = @svmQPregPredict;
    otherwise
        predictName = [model.fitEngine(1:end-3), 'predict'];
        if exist(predictName, 'file')
            predictFn = str2func(predictName);
        else
            error('Could not find %s', predictName);
        end
end
probability = [];
if nargout > 2
    if ~strcmp(model.fitEngine, 'svmlibFit')
        error('PMTK:SvmProbabilityUnavailable', 'Probability output is supported by the LIBSVM engine only');
    end
    [yhat, f, probability] = predictFn(model, Xtest);
elseif nargout < 2
    yhat = predictFn(model, Xtest);
else
    % currrently only supported by svmQPclassif*
    [yhat, f] = predictFn(model, Xtest); 
end

if isfield(model, 'outputType')
    % This field is set at the end of svmFit. If it hasn't been set,
    % svmPredict is being called by cross validation, and we don't want to
    % reset the support yet.
    switch model.outputType
        case 'binary',
            yhat = setSupport(yhat, model.ySupport, [-1 1]);
            if nargout >= 2 && strcmp(model.fitEngine, 'svmlibFit') && model.Label(1) == -1, f = -f; end
        case 'multiclass'
            yhat = setSupport(yhat, model.ySupport, 1:numel(model.ySupport));
    end
    if ~isempty(probability)
        if strcmp(model.outputType, 'binary'), codes = [-1 1]; else, codes = 1:numel(model.ySupport); end
        [present, order] = ismember(codes, model.Label(:)');
        if ~all(present), error('PMTK:SvmProbabilityLabels', 'Native LIBSVM class labels do not match model support'); end
        probability = probability(:, order);
    end
end
end
