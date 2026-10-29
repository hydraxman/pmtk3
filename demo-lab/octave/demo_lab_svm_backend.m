function demo_lab_svm_backend()
% Deterministic API/math checks using the genuine installed native backend.
% Diagnostic only; never represented as execution of an original demo.
report = struct('provider', svmLibsvmBackend('info'));
assert(report.provider.available && svmInstalled());
X = [-2; -1; 1; 2]; y = [10; 10; 20; 20];
model = svmFit(X, y, 'kernel', 'linear', 'C', 10, 'standardizeX', false);
[labels, decisions] = svmPredict(model, X);
assert(isequal(labels, y));
assert(max(abs(decisions-X)) < 1e-8);
assert(strcmp(model.fitEngine, 'svmlibFit'));
assert(isequal(model.svi, model.sv_indices(:)));
assert(isequal(model.supportVectors, X(model.svi, :)));
assert(max(abs(X*X'*model.alpha-model.rho-decisions)) < 1e-8);
report.binary = struct('labels', labels, 'decisions', decisions, 'support_indices', model.svi, ...
    'coefficient_reconstruction_error', max(abs(X*X'*model.alpha-model.rho-decisions)));
sparse_model = svmFit(sparse(X), y, 'kernel', 'linear', 'C', 10, 'standardizeX', false);
assert(isequal(svmPredict(sparse_model, sparse(X)), y));
qp = struct('fitEngine', 'svmQPclassifFit', 'outputType', 'binary', 'ySupport', [10 20], ...
    'X', [-1;1], 'y', [-1;1], 'alpha', [.5;.5], 'bias', 0, 'kernelParam', 1, ...
    'kernelFn', @(A,B,unused) A*B');
[qp_labels, qp_values] = svmPredict(qp, [-2;2]);
assert(isequal(qp_labels, [10;20]) && isequal(qp_values, [-2;2]));

% Prediction must apply TRAINING centering/scaling, independently of batching.
scaled = svmFit(10+3*X, y, 'kernel', 'linear', 'C', 10);
test = [9.5; 10.5; 13];
[batch, batch_decisions] = svmPredict(scaled, test);
single = zeros(size(test)); single_decisions = single;
for k = 1:numel(test)
    [single(k), single_decisions(k)] = svmPredict(scaled, test(k));
end
assert(isequal(batch, [10;20;20]) && isequal(batch, single));
assert(max(abs(batch_decisions-single_decisions)) < 1e-10);
report.preprocessing = struct('batch', batch, 'single', single, ...
    'maximum_decision_difference', max(abs(batch_decisions-single_decisions)));

% Epsilon-SVR on a known affine function; signed dual coefficients reproduce f.
rx = (-2:2)'; ry = 1.3*rx + .2; epsilon = .01;
reg = svmFit(rx, ry, 'kernel', 'linear', 'C', 100, 'standardizeX', false, ...
    'fitOptions', {'epsilonTube', epsilon});
[prediction, values] = svmPredict(reg, rx);
assert(reg.Parameters(1) == 3 && strcmp(reg.outputType, 'regression'));
error_bound = max(abs(prediction-ry));
assert(error_bound <= epsilon+1e-7);
assert(max(abs(prediction-values)) < 1e-10);
assert(max(abs(rx*rx'*reg.alpha-reg.rho-prediction)) < 1e-8);
assert(abs(svmPredict(reg, rx(2))-prediction(2)) < 1e-10);
report.regression = struct('target', ry, 'prediction', prediction, ...
    'epsilon_tube', epsilon, 'maximum_absolute_error', error_bound, 'support_indices', reg.svi);
integer_reg = svmlibFit(rx, 2*rx, 100, 1, 'linear', 'customOptions', '-s 3 -t 0 -c 100 -p 0.01');
integer_prediction = svmPredict(integer_reg, rx);
assert(integer_reg.Parameters(1) == 3 && max(abs(integer_prediction-2*rx)) <= epsilon+1e-7);
report.integer_target_svr = struct('explicit_svm_type', integer_reg.Parameters(1), ...
    'maximum_absolute_error', max(abs(integer_prediction-2*rx)));

% Native multiclass order deliberately differs from sorted public label support.
offset = [-.2 0; .2 0; 0 -.2; 0 .2; -.1 .1; .1 -.1];
mx = [bsxfun(@plus, offset, [0 3]); bsxfun(@plus, offset, [-3 -3]); ...
      bsxfun(@plus, offset, [3 0])];
my = [40*ones(6,1); 10*ones(6,1); 20*ones(6,1)];
multi = svmFit(mx, my, 'kernel', 'rbf', 'kernelParam', .7, 'C', 10, ...
    'standardizeX', false, 'fitOptions', {'estProb', 1});
[multi_labels, pairwise, probabilities] = svmPredict(multi, mx);
assert(isequal(multi_labels, my));
assert(isequal(size(pairwise), [18 3]) && isequal(size(probabilities), [18 3]));
assert(all(isfinite(probabilities(:))) && all(probabilities(:) >= 0) && all(probabilities(:) <= 1));
assert(max(abs(sum(probabilities,2)-1)) < 1e-10);
assert(isequal(svmPredict(multi, mx(7:12,:)), 10*ones(6,1)));
native = rmfield(multi, setdiff(fieldnames(multi), multi.libsvmFields));
[~, ~, raw_probability] = svmLibsvmBackend('predict', zeros(18,1), mx, native, '-b 1 -q');
[~, order] = ismember(1:3, multi.Label(:)');
assert(max(abs(probabilities(:)-raw_probability(:,order)(:))) < 1e-12);
[single_class, single_pairwise, single_probability] = svmPredict(multi, mx(1,:));
assert(single_class == multi_labels(1));
assert(max(abs(single_pairwise-pairwise(1,:))) < 1e-10);
assert(max(abs(single_probability-probabilities(1,:))) < 1e-10);
report.multiclass = struct('accuracy', mean(multi_labels == my), 'native_label_order', multi.Label, ...
    'probability_label_order', multi.probabilityLabels, 'decision_shape', size(pairwise), ...
    'probability_row_sum_error', max(abs(sum(probabilities,2)-1)), 'probabilities', probabilities);

% Kernel identity and precomputed-kernel contracts, without transforming serials.
poly = svmFit(X, y, 'kernel', 'poly', 'kernelParam', 3, 'C', 10, 'standardizeX', false);
assert(poly.Parameters(2) == 1 && poly.Parameters(3) == 3);
assert(isequal(svmPredict(poly, X), y));
precomputed = svmFit([(1:4)' X*X'], y, 'kernel', 'precomputed', 'C', 10, 'standardizeX', false);
[pre_labels, pre_decision] = svmPredict(precomputed, [(1:4)' X*X']);
assert(isequal(pre_labels, y) && max(abs(pre_decision-decisions)) < 1e-8);
report.kernels = struct('polynomial_parameters', poly.Parameters, ...
    'precomputed_parameters', precomputed.Parameters, ...
    'linear_precomputed_decision_difference', max(abs(pre_decision-decisions)));
cv_accuracy = svmLibsvmBackend('train', [-1;-1;1;1], X, '-t 0 -c 10 -v 2 -q');
assert(isscalar(cv_accuracy) && cv_accuracy == 100);
report.native_cross_validation_accuracy = cv_accuracy;
try
    [unused_a, unused_b, unused_c] = svmPredict(model, X);
    error('demo_lab:svmTest', 'Untrained probability request did not fail');
catch err
    assert(strcmp(err.identifier, 'PMTK:SvmProbabilityUnavailable'));
end
[~, whole_partition] = normalize(ones(2,2,2));
assert(isscalar(whole_partition) && whole_partition == 8);
report.normalize_origin_after_backend = which('normalize');
report.sparse_and_custom_qp_prediction_preserved = true;
report.passed = true;
filename = fullfile(getenv('DEMO_LAB_ATTEMPT'), 'svm-backend-tests.json');
fid = fopen(filename, 'w');
if fid < 0, error('demo_lab:svmTest', 'Cannot write SVM diagnostic'); end
fprintf(fid, '%s\n', jsonencode(report));
fclose(fid);
end
