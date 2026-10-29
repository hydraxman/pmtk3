function demo_lab_native_spams()
% Genuine SPAMS dictionary learning, independently checked tiny L1 encodings.
repo=fileparts(fileparts(fileparts(mfilename('fullpath'))));
if isempty(getenv('PMTK_NATIVE_TEST_INSTALLED'))
    addpath(fullfile(repo,'.demo-runtime/native-providers/build/spams-2.6'),'-begin');
end
assert(exist('mexTrainDL','file')==3);
report.origin=which('mexTrainDL');
X=repmat([eye(3),-eye(3)],1,10);
param=struct('D',eye(3),'iter',80,'batchsize',12,'numThreads',1,'lambda',.1, ...
    'lambda2',0,'mode',2,'modeD',0,'verbose',false,'clean',false);
original=X;
[D,model]=mexTrainDL(X,param);
assert(isequal(original,X) && all(isfinite(D(:))));
gram_error=max(abs((D'*D-eye(3))(:)));
assert(gram_error<1e-6 && max(sum(D.^2,1))<=1+1e-8);
A=sign(D'*X).*max(abs(D'*X)-param.lambda,0);
residual=X-D*A;reconstruction_mse=sum(residual(:).^2)/size(X,2);
objective=.5*reconstruction_mse+param.lambda*sum(abs(A(:)))/size(X,2);
assert(abs(reconstruction_mse-.01)<1e-6 && abs(objective-.095)<1e-6);
assert(all(sum(abs(A)>1e-8,1)==1));
assert(isequal(size(model.A),[3,3]) && isequal(size(model.B),[3,3]) && model.iter>0);
report.orthogonal=struct('gram_max_error',gram_error,'reconstruction_mse',reconstruction_mse, ...
    'expected_mse',.01,'objective',objective,'expected_objective',.095, ...
    'nonzeros_per_signal',1,'model_iterations',model.iter);
% Nontrivial optimization from a nonorthogonal dictionary. The independent
% exact tiny Lasso oracle enumerates active sets/signs, not a SPAMS coder.
initial=[1,.2,0;0,1,.2;.2,0,1];
initial=bsxfun(@rdivide,initial,sqrt(sum(initial.^2,1)));
param.D=initial;param.iter=200;
before=oracle_objective(initial,X,param.lambda);
[learned,learned_model]=mexTrainDL(X,param);
after=oracle_objective(learned,X,param.lambda);
assert(after<before-1e-3 && all(isfinite(learned(:))));
assert(max(sum(learned.^2,1))<=1+1e-8);
assert(norm(learned-initial,'fro')>1e-3);
report.learning=struct('initial_objective',before,'learned_objective',after, ...
    'improvement',before-after,'dictionary_change',norm(learned-initial,'fro'), ...
    'maximum_atom_norm',max(sqrt(sum(learned.^2,1))),'iterations',learned_model.iter);
param.D=D;param.iter=5;
[warm,warm_model]=mexTrainDL(X,param,model);
assert(all(isfinite(warm(:))) && warm_model.iter>model.iter);
report.warm_start=true;
bad=rmfield(param,'D');bad.K=2^31;
try
    fail=mexTrainDL(X,bad);
    error('Test:ExpectedFailure','Oversized SPAMS K unexpectedly accepted');
catch exception
    assert(~strcmp(exception.identifier,'Test:ExpectedFailure'));
    report.invalid_int32_rejected=exception.identifier;
end
report.passed=true;report.octave_version=version;
fid=fopen(fullfile(getenv('DEMO_LAB_ATTEMPT'),'spams-tests.json'),'w');assert(fid>=0);
cleanup=onCleanup(@()fclose(fid));fprintf(fid,'%s\n',jsonencode(report));
end

function value=oracle_objective(D,X,lambda)
K=size(D,2);value=0;
for j=1:size(X,2)
    x=X(:,j);best=inf;
    for code=0:3^K-1
        signs=zeros(K,1);
        for k=1:K, signs(k)=mod(floor(code/3^(k-1)),3)-1; end
        active=find(signs);a=zeros(K,1);
        if ~isempty(active)
            G=D(:,active)'*D(:,active);
            if rcond(G)<1e-12,continue;end
            a(active)=G\(D(:,active)'*x-lambda*signs(active));
            if any(sign(a(active))~=signs(active)),continue;end
        end
        gradient=D'*(D*a-x);
        inactive=find(~signs);
        if any(abs(gradient(inactive))>lambda+1e-8),continue;end
        if ~isempty(active) && max(abs(gradient(active)+lambda*signs(active)))>1e-8,continue;end
        loss=.5*sum((x-D*a).^2)+lambda*sum(abs(a));
        best=min(best,loss);
    end
    assert(isfinite(best));value=value+best;
end
value=value/size(X,2);
end
