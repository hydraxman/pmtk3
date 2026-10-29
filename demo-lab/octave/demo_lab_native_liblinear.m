function demo_lab_native_liblinear()
% Real native diagnostic, never counted as an original demo.
before = struct('train',which('train'),'predict',which('predict'), ...
    'svmtrain',which('svmtrain'),'normalize',which('normalize'));
provider = svmLiblinearBackend('info');
assert(provider.available && exist('pmtk_liblinear_train','file') == 3);
assert(exist('pmtk_liblinear_predict','file') == 3);
X = [-2;-1;1;2];
y = [10;10;20;20];
options = {'-s 2 -c 1 -e 1e-12 -q'};
model = svmFit(X,y,'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',1,'standardizeX',false,'fitOptions',options);
[labels,decisions] = svmPredict(model,X);
% Solver 2: 1/2*w^2 + sum(max(0,1-y*x*w)^2). Only x=+-1 are
% active at optimum; derivative 5*w-4=0 gives w=4/5, objective=2/5.
expected_weight = 4/5;
expected_decisions = X*expected_weight;
assert(model.Parameters(1) == 2 && model.bias == -1);
assert(strcmp(model.fitEngine,'svmlibLinearFit'));
assert(isequal(labels,y));
assert(max(abs(decisions-expected_decisions)) < 1e-9);
assert(abs(model.linearWeights-expected_weight) < 1e-9);
assert(model.linearIntercept == 0);
signed = [-1;-1;1;1];
slack = max(0,1-signed.*decisions);
objective = .5*model.linearWeights^2+sum(slack.^2);
gradient = model.linearWeights-2*sum(signed.*X.*slack);
assert(abs(objective-.4) < 1e-12 && abs(gradient) < 1e-8);
assert(svmPredict(model,0) == 10); % native exact-zero tie, not class zero
report.analytical = struct('solver',model.Parameters(1),'weight',model.linearWeights, ...
    'expected_weight',expected_weight,'decisions',decisions,'labels',labels, ...
    'objective',objective,'gradient_residual',abs(gradient), ...
    'maximum_decision_error',max(abs(decisions-expected_decisions)));

% Same squared-hinge objective through the original default dual solver.
dual = svmlibLinearFit(X,signed,1,[], 'linear','-s 1 -c 1 -e 1e-10 -q');
[dual_labels,dual_decisions] = svmlibLinearPredict(dual,X);
assert(isequal(dual_labels,signed));
assert(max(abs(dual_decisions-expected_decisions)) < 1e-7);
report.dual_primal_maximum_difference = max(abs(dual_decisions-decisions));
% Default Octave route must remain the independently working native LIBSVM.
default_model = svmFit(X,y,'kernel','linear','C',1,'standardizeX',false);
[default_labels,default_decisions] = svmPredict(default_model,X);
assert(strcmp(default_model.fitEngine,'svmlibFit') && isequal(default_labels,y));
assert(max(abs(default_decisions-decisions)) > .1);
report.unchanged_default = struct('fit_engine',default_model.fitEngine, ...
    'decisions',default_decisions,'liblinear_decision_difference',max(abs(default_decisions-decisions)));

sparse_model = svmFit(sparse(X),y,'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',1,'standardizeX',false,'fitOptions',options);
assert(isequal(svmPredict(sparse_model,sparse(X)),y));
reverse_labels = [40;40;10;10];
reverse_model = svmFit(X,reverse_labels,'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',1,'standardizeX',false,'fitOptions',options);
[reverse_prediction,reverse_decision] = svmPredict(reverse_model,X);
assert(isequal(reverse_prediction,reverse_labels));
assert(max(abs(reverse_decision+expected_decisions)) < 1e-9);

% Regularized bias feature B=1: analytic minimizer is w=20/29,b=-16/29.
biased = svmFit([0;2],[10;20],'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',1,'standardizeX',false,'fitOptions',{'-s 2 -c 1 -B 1 -e 1e-12 -q'});
[bias_labels,bias_decisions] = svmPredict(biased,[0;2]);
assert(isequal(bias_labels,[10;20]));
assert(biased.bias == 1 && abs(biased.linearWeights-20/29) < 1e-8);
assert(abs(biased.linearIntercept+16/29) < 1e-8);
assert(max(abs(bias_decisions-[-16/29;24/29])) < 1e-8);
report.bias = struct('native_bias_feature',biased.bias,'weight',biased.linearWeights, ...
    'intercept',biased.linearIntercept,'decisions',bias_decisions);

scaled = svmFit(10+3*X,y,'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',1,'fitOptions',options);
query = [9.5;10.5;13];
[batch,batch_decisions] = svmPredict(scaled,query);
single = zeros(size(query)); single_decisions = single;
for k = 1:numel(query)
    [single(k),single_decisions(k)] = svmPredict(scaled,query(k));
end
assert(isequal(batch,[10;20;20]) && isequal(batch,single));
assert(max(abs(single_decisions-batch_decisions)) < 1e-12);
manual = bsxfun(@rdivide,bsxfun(@minus,query,scaled.svmPreprocess.center),scaled.svmPreprocess.scale);
manual = manual*scaled.linearWeights'+scaled.linearIntercept;
if scaled.Label(1) == -1, manual = -manual; end
assert(max(abs(manual-batch_decisions)) < 1e-12);
report.preprocessing = struct('batch',batch,'single',single, ...
    'batching_error',max(abs(single_decisions-batch_decisions)), ...
    'manual_training_transform_error',max(abs(manual-batch_decisions)));

mx = [-3 -3;-2.5 -3;3 0;3 .5;0 3;.5 3];
my = [40;40;10;10;20;20];
multi = svmFit(mx,my,'kernel','linear','fitFn',@svmlibLinearFit,'C',10,'standardizeX',false);
[multi_labels,scores] = svmPredict(multi,mx);
assert(multi.Parameters(1) == 4 && isequal(multi_labels,my));
assert(isequal(size(scores),[6 3]));
[unused,index] = max(scores,[],2);
assert(isequal(reshape(multi.ySupport(index),[],1),my));
report.multiclass = struct('solver',multi.Parameters(1),'accuracy',mean(multi_labels==my), ...
    'native_label_order',multi.Label,'decision_label_order',multi.decisionLabels);
cv_x = repmat(X,4,1);
cv_y = repmat(y,4,1);
cv = svmFit(cv_x,cv_y,'kernel','linear','fitFn',@svmlibLinearFit, ...
    'C',[.5 1],'standardizeX',false,'cvOptions',{2});
assert(ismember(cv.C,[.5 1]) && strcmp(cv.fitEngine,'svmlibLinearFit'));
assert(isequal(svmPredict(cv,cv_x),cv_y));
report.public_cross_validation = struct('selected_C',cv.C, ...
    'accuracy',mean(svmPredict(cv,cv_x)==cv_y),'provider',cv.liblinearProvider.name);

try
    svmFit(X,y,'fitFn',@svmlibLinearFit,'kernel','rbf','standardizeX',false);
    error('demo_lab:LiblinearTest','Nonlinear kernel incorrectly accepted');
catch err
    assert(strcmp(err.identifier,'PMTK:LiblinearKernel'));
end
try
    [unused_a,unused_b,unused_c] = svmPredict(model,X);
    error('demo_lab:LiblinearTest','Untested probability API incorrectly claimed');
catch err
    assert(strcmp(err.identifier,'PMTK:SvmProbabilityUnavailable'));
end
after = struct('train',which('train'),'predict',which('predict'), ...
    'svmtrain',which('svmtrain'),'normalize',which('normalize'));
assert(isequal(before,after));
[unused,z] = normalize(ones(2,2,2));
assert(isscalar(z) && z == 8);
report.provider = provider;
report.octave_version = OCTAVE_VERSION;
report.global_origins_unchanged = after;
report.regression_and_probability_claimed = false;
report.passed = true;
filename = fullfile(getenv('DEMO_LAB_ATTEMPT'),'liblinear-tests.json');
fid = fopen(filename,'w');
if fid < 0, error('demo_lab:LiblinearTest','Cannot write native diagnostic'); end
fprintf(fid,'%s\n',jsonencode(report));
fclose(fid);
end
