function demo_lab_native_libdai()
% Independent exact enumeration of a tiny genuine libDAI chain.
repo=fileparts(fileparts(fileparts(mfilename('fullpath'))));
if isempty(getenv('PMTK_NATIVE_TEST_INSTALLED'))
    addpath(fullfile(repo,'.demo-runtime/native-providers/build/libdai-fullwidth'),'-begin');
end
assert(exist('dai','file')==3 && isLibdaiInstalled());
report.dai_origin=which('dai');
unary=[2;3]; pair01=[4,1;2,5]; pair12=[3,2;1,6];
psi={struct('Member',0,'P',unary),struct('Member',[0,1],'P',pair01), ...
     struct('Member',[1,2],'P',pair12)};
weights=zeros(2,2,2);
for a=1:2,for b=1:2,for c=1:2
    weights(a,b,c)=unary(a)*pair01(a,b)*pair12(b,c);
end,end,end
partition=sum(weights(:)); posterior=weights/partition;
marginals=[reshape(sum(sum(posterior,3),2),2,1), ...
    reshape(sum(sum(posterior,3),1),2,1),reshape(sum(sum(posterior,2),1),2,1)];
methods={'JTREE','BP'};
properties={'[updates=HUGIN,inference=SUMPROD,verbose=0]', ...
    '[updates=SEQFIX,tol=1e-12,maxiter=1000,logdomain=0,verbose=0]'};
for k=1:2
    [logZ,q,md,node,factors]=dai(psi,methods{k},properties{k});
    actual=extract_nodes(node,[0,1,2]);
    error=max(abs(actual(:)-marginals(:)));
    assert(abs(logZ-log(partition))<1e-10 && error<1e-10);
    assert(numel(factors)==3 && all(isfinite(actual(:))));
    report.(methods{k})=struct('logZ',logZ,'expected_logZ',log(partition), ...
        'marginal_max_error',error,'maxdiff',md,'factor_beliefs',numel(factors));
end
% MAXPROD's logZ/beliefs are not the posterior partition/marginals.
[ignore1,ignore2,ignore3,ignore4,ignore5,map]=dai(psi,'JTREE', ...
    '[updates=HUGIN,inference=MAXPROD,verbose=0]');
[maximum,index]=max(weights(:));[a,b,c]=ind2sub(size(weights),index);
expected_map=uint32([a;b;c]-1);
assert(isa(map,'uint32') && isequal(map,expected_map));
report.map=struct('actual',map,'expected',expected_map,'weight',maximum);
% Reverse factor variable ordering and exercise labels exceeding LLP64 long.
labels=[0,2^32+7,2^32+19];
permuted={struct('Member',labels(1),'P',unary), ...
    struct('Member',labels([2,1]),'P',pair01'), ...
    struct('Member',labels([3,2]),'P',pair12')};
[logZ,q,md,node]=dai(permuted,'JTREE',properties{1});
actual=extract_nodes(node,labels);
assert(abs(logZ-log(partition))<1e-10 && max(abs(actual(:)-marginals(:)))<1e-10);
report.fullwidth_labels=struct('labels',labels,'marginal_max_error',max(abs(actual(:)-marginals(:))));
% Genuine upstream errors must remain recoverable host exceptions.
try
    [a,b,c]=dai(psi,'NOT_AN_ALGORITHM','[]');
    error('Test:ExpectedFailure','Unknown native algorithm unexpectedly succeeded');
catch exception
    assert(~strcmp(exception.identifier,'Test:ExpectedFailure'));
    assert(~isempty(strfind(exception.identifier,'libDAI:')));
    report.exception=struct('identifier',exception.identifier,'message',exception.message);
end
try
    malformed={struct('Member',0,'P',[1,2])};
    [a,b,c]=dai(malformed,'JTREE',properties{1});
    error('Test:ExpectedFailure','Undescribed table dimension unexpectedly succeeded');
catch exception
    assert(~strcmp(exception.identifier,'Test:ExpectedFailure'));
    report.invalid_dimension_rejected=true;
end
% Verify host remains usable after native exceptions, not just loadable.
[logZ,q,md]=dai(psi,'JTREE',properties{1});assert(abs(logZ-log(partition))<1e-10);
report.passed=true;report.octave_version=version;
filename=fullfile(getenv('DEMO_LAB_ATTEMPT'),'libdai-tests.json');
fid=fopen(filename,'w');assert(fid>=0);cleanup=onCleanup(@()fclose(fid));
fprintf(fid,'%s\n',jsonencode(report));
end

function actual=extract_nodes(nodes,labels)
actual=zeros(2,numel(labels));
for j=1:numel(labels)
    found=false;
    for i=1:numel(nodes)
        if isequal(nodes{i}.Member,labels(j))
            actual(:,j)=nodes{i}.P(:);found=true;break;
        end
    end
    assert(found);
end
end
