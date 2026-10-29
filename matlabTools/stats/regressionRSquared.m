function value = regressionRSquared(response, predictors)
% R-squared of an ordinary least-squares fit with an intercept.
if ~isnumeric(response) || ~isreal(response) || ~isvector(response) ...
        || isempty(response) || any(~isfinite(response(:))) ...
        || ~isnumeric(predictors) || ~isreal(predictors) ...
        || ndims(predictors) ~= 2 || size(predictors,1) ~= numel(response) ...
        || any(~isfinite(predictors(:)))
    error('PMTK:InvalidRegressionSamples', 'Expected finite real responses and a matching predictor matrix.');
end
response = double(response(:));
predictors = double(predictors);
design = [ones(numel(response),1), predictors];
fitted = design*(design\response);
total = sum((response-mean(response)).^2);
if total == 0
    warning('PMTK:UndefinedRSquared', 'Regression R-squared is undefined for a constant response.');
    value = NaN;
else
    value = 1-sum((response-fitted).^2)/total;
end
end
