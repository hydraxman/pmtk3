function [yhat, f] = svmlibLinearPredict(model, Xtest)
% PMTK interface to svm liblinear
% model is returned by svmlibLinearFit
% f is a signed binary score toward the larger encoded label, or multiclass
% scores in sorted label order. Native predictions retain native tie handling.
%%

% This file is from pmtk3.googlecode.com

if ~isnumeric(Xtest) || ~isreal(Xtest) || size(Xtest,2) ~= model.nr_feature
    error('PMTK:LiblinearFeatures', 'Test features must match the trained LIBLINEAR feature dimension.');
end
native = model;
if isfield(model,'liblinearFields')
    native = rmfield(model,setdiff(fieldnames(model),model.liblinearFields));
end
n = size(Xtest,1);
if n == 0
    yhat = zeros(0,1);
    if model.nr_class == 2, f = zeros(0,1); else, f = zeros(0,model.nr_class); end
    return;
end
if n*model.nr_class > double(intmax('int32'))-2
    error('PMTK:LiblinearSize', 'Prediction score storage exceeds the native signed-int indexing bound.');
end
[yhat, unused_accuracy, raw] = svmLiblinearBackend('predict',zeros(n,1),sparse(double(Xtest)),native,'-q -b 0');
if model.nr_class == 2
    % Signed score toward the larger encoded label, consistent with svmFit's
    % [-1,+1] mapping. Native class labels/predictions are never reconstructed.
    if size(raw,2) == 1
        f = raw;
        if model.Label(1) == min(model.Label), f = -f; end
    else
        high = find(model.Label == max(model.Label),1);
        low = find(model.Label == min(model.Label),1);
        f = raw(:,high)-raw(:,low);
    end
else
    [unused_labels,order] = sort(model.Label(:)');
    f = raw(:,order);
end
end
