function demo_lab_native_glmnet()
% Real official GLMnet Fortran; independent orthogonal design and logistic oracles.
repo=fileparts(fileparts(fileparts(mfilename('fullpath'))));
if isempty(getenv('PMTK_NATIVE_TEST_INSTALLED'))
    addpath(fullfile(repo,'.demo-runtime/native-providers/build/glmnet-2013/compat'),'-begin');
    addpath(fullfile(repo,'.demo-runtime/native-providers/build/glmnet-2013'),'-begin');
end
assert(exist('glmnetMex','file')==3);
report.origin=which('glmnetMex');report.abi=glmnetMex('abi');
assert(report.abi.integer_bits==32 && report.abi.real_bits==32 && report.abi.mex_dimension_bits==64);
before=struct('svmtrain',which('svmtrain'),'normalize',which('normalize'),'glmnet',which('glmnet'));
Z=repmat([-1,-1;-1,1;1,-1;1,1],4,1);y=2+Z*[.6;.8];
options=glmnetSet;options.lambda=[.5,.2,.05];options.standardize=false;
options.thresh=1e-10;
options.maxit=1; % deliberately NOT an implicit source of the explicit new-core budget
options.octave_max_passes=100000;options.octave_require_complete=true;
originalZ=Z;originaly=y;
for alpha=[1,0]
    options.alpha=alpha;fit=glmnet(Z,y,'gaussian',options);
    assert(fit.jerr==0 && numel(fit.lambda)==3);
    assert(fit.octave_budget.max_passes==100000 && fit.octave_budget.require_complete);
    assert(fit.octave_budget.completed_lambda_count==fit.octave_budget.requested_lambda_count);
    if alpha==1
        expected=max(bsxfun(@minus,[.6;.8],options.lambda),0);
        name='lasso';
    else
        expected=bsxfun(@rdivide,[.6;.8],1+options.lambda);
        name='ridge';
    end
    coefficient_error=max(abs(fit.beta(:)-expected(:)));
    prediction=glmnetPredict(fit,'response',Z);
    target=2+Z*expected;
    assert(coefficient_error<2e-5 && max(abs(fit.a0(:)-2))<2e-5);
    assert(max(abs(prediction(:)-target(:)))<3e-5);
    report.(name)=struct('coefficients',fit.beta,'expected',expected, ...
        'coefficient_max_error',coefficient_error,'prediction_max_error',max(abs(prediction(:)-target(:))), ...
        'native_jerr',fit.jerr,'lambda',fit.lambda,'budget',fit.octave_budget);
end
assert(isequal(originalZ,Z) && isequal(originaly,y));
% Public preprocessing unscales coefficients/intercept to original X units.
X=bsxfun(@plus,bsxfun(@times,Z,[3,5]),[10,-4]);
options.alpha=1;options.standardize=true;
fit=glmnet(X,y,'gaussian',options);
expected=bsxfun(@rdivide,max(bsxfun(@minus,[.6;.8],options.lambda),0),[3;5]);
intercept=2-[10,-4]*expected;
assert(fit.jerr==0 && max(abs(fit.beta(:)-expected(:)))<2e-5);
assert(max(abs(fit.a0(:)-intercept(:)))<3e-5);
report.preprocessing=struct('coefficient_max_error',max(abs(fit.beta(:)-expected(:))), ...
    'intercept_max_error',max(abs(fit.a0(:)-intercept(:))));
% Four balanced independent folds: every training/test design remains
% orthogonal, so exact test MSE is 2*lambda^2 for this L1 example.
options.standardize=false;
foldid=kron((1:4)',ones(4,1));
cv=cvglmnet(Z,y,4,foldid,'response','gaussian',options,0);
expected_cv=2*options.lambda.^2;
assert(max(abs(cv.cvm-expected_cv))<3e-5 && cv.glmnet_object.jerr==0);
report.cv=struct('actual_mse',cv.cvm,'expected_mse',expected_cv, ...
    'maximum_error',max(abs(cv.cvm-expected_cv)),'folds',4);
% Balanced binary x=+-1. For alpha=1 and lambda>0, logistic gradient
% gives p(y=2|x=1)=1-lambda, beta=log((1-lambda)/lambda).
options.lambda=[.2,.1,.05];options.alpha=1;options.standardize=false;
xb=[-1;-1;1;1];yb=[1;1;2;2];
fit=glmnet(xb,yb,'binomial',options);
probability=glmnetPredict(fit,'response',[-1;1]);
labels=glmnetPredict(fit,'class',[-1;1]);
expected_probability=[options.lambda;1-options.lambda];
expected_beta=log((1-options.lambda)./options.lambda);
assert(fit.jerr==0 && max(abs(fit.beta(:)-expected_beta(:)))<1e-4);
assert(max(abs(probability(:)-expected_probability(:)))<2e-5);
assert(isequal(labels,repmat([1;2],1,3)));
assert(fit.octave_budget.max_passes==100000 && fit.octave_budget.completed_lambda_count==3);
report.binomial=struct('coefficients',fit.beta,'expected',expected_beta,'budget',fit.octave_budget, ...
    'probabilities',probability,'labels',labels,'native_jerr',fit.jerr, ...
    'probability_max_error',max(abs(probability(:)-expected_probability(:))));
% Genuine multinomial ABI and the untouched public probability layout.
options.lambda=[.05,.02,.005];
xm=[-2,-1;-2,1;2,-1;2,1;0,2;0,3];ym=[1;1;2;2;3;3];
multi=glmnet(xm,ym,'multinomial',options);
prob=glmnetPredict(multi,'response',xm);
assert(multi.jerr==0 && isequal(size(prob),[6,3,3]));
normalization_error=0;
for k=1:3
    [maximum,predicted]=max(prob(:,:,k),[],2);
    assert(isequal(predicted,ym));
    normalization_error=max(normalization_error,max(abs(sum(prob(:,:,k),2)-1)));
end
assert(normalization_error<1e-12 && all(isfinite(prob(:))) && all(prob(:)>=0));
report.multinomial=struct('classes',3,'lambda_count',3,'training_accuracy',1, ...
    'probability_normalization_max_error',normalization_error,'native_jerr',multi.jerr);
% An explicitly too-small budget must be honored, not silently enlarged.
limited=options;limited.octave_max_passes=1;limited.octave_require_complete=true;
try
    fit=glmnet(xb,yb,'binomial',limited);
    error('Test:ExpectedFailure','A one-pass complete-path request unexpectedly succeeded');
catch exception
    assert(strcmp(exception.identifier,'PMTK:GlmnetIncompletePath'));
    report.small_budget_rejected=struct('identifier',exception.identifier,'message',exception.message);
end
% The Gaussian legacy call ignores options.maxit (it has no maxit argument).
defaults=options;defaults.octave_max_passes=[];defaults.octave_require_complete=false;
defaults.lambda=[.5,.2,.05];
fit=glmnet(Z,y,'gaussian',defaults);
assert(fit.octave_budget.max_passes==100000);
assert(strcmp(fit.octave_budget.limit_source,'gaussian_bridge_default'));
report.gaussian_no_explicit_budget=fit.octave_budget;
% Invalid int32 controls fail before allocating/entering Fortran.
try
    [a,b,c,d,e,f,g,h]=glmnetMex(1,Z,y,0,ones(2,1),3,2,2^31,1,0,1e-8,0,ones(16,1),1);
    error('Test:ExpectedFailure','Oversized Fortran control unexpectedly accepted');
catch exception
    assert(~strcmp(exception.identifier,'Test:ExpectedFailure'));
    report.invalid_int32_rejected=exception.identifier;
end
after=struct('svmtrain',which('svmtrain'),'normalize',which('normalize'),'glmnet',which('glmnet'));
assert(isequal(before,after));
report.unchanged_public_origins=after;report.input_arrays_unchanged=true;
report.passed=true;report.octave_version=version;
fid=fopen(fullfile(getenv('DEMO_LAB_ATTEMPT'),'glmnet-tests.json'),'w');assert(fid>=0);
cleanup=onCleanup(@()fclose(fid));fprintf(fid,'%s\n',jsonencode(report));
end
