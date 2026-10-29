function report = test_residual_support(root)
% Numerical checks under the already configured demo-lab path, not a demo.
base = fullfile(root, 'pmtksupportCopy', 'packages', 'markSchmidt-9march2011', 'markSchmidt');
assert(strcmpi(which('projectRandom2C'), fullfile(base, 'L1GeneralGroup', 'mex', 'projectRandom2C.m')));
assert(strcmpi(which('projectRandom2'), fullfile(base, 'L1GeneralGroup', 'projectRandom2.m')));
assert(strcmpi(which('UGM_MFGibbsFreeEnergy'), fullfile(base, 'UGM', 'sub', 'UGM_MFGibbsFreeEnergy.m')));
% Current Octave has no recognized compatible projection MEX. Do not blindly
% execute one of the bundled foreign/old-ABI binaries in this diagnostic.
assert(exist('projectRandom2C', 'file') == 2);
rand('state', 37);
randn('state', 37);
cases = {[3;1;2], 2; [2;2;2;0], 3; [3;0;1], 0; ...
    [0.1;0.2], 1; zeros(4,1), 0; zeros(0,1), 0; [1 2 3], 2; [1;2], Inf};
maximum_error = 0;
maximum_kkt_error = 0;
for trial = 1:80
    c = abs(round(7*randn(17,1)))/3; % deliberate ties and zero components
    radius = sum(c)*(mod(trial,6)/4);
    cases(end+1,:) = {c, radius};
end
for trial = 1:size(cases,1)
    c = cases{trial,1};
    radius = cases{trial,2};
    p = projectRandom2C(c, radius);
    assert(isequal(size(p), size(c)));
    expected = projection_oracle(c, radius);
    difference = norm(p(:)-expected(:), Inf);
    if isempty(difference), difference = 0; end
    maximum_error = max(maximum_error, difference);
    assert(difference < 1e-10 && all(p(:) >= 0));
    if isfinite(radius)
        assert(sum(p(:)) <= radius+1e-10);
        active = p(:) > 1e-12;
        if any(active)
            theta = mean(c(active)-p(active));
        elseif isempty(c)
            theta = 0;
        else
            theta = max(c(:));
        end
        residual = norm(p(:)-max(c(:)-theta,0), Inf);
        if isempty(residual), residual = 0; end
        maximum_kkt_error = max(maximum_kkt_error, residual);
        assert(theta >= -1e-10 && residual < 1e-10);
        assert(abs(theta*(sum(p(:))-radius)) < 1e-9);
    end
end
signed = [-3;1;2];
assert(norm(sign(signed).*projectRandom2C(abs(signed),2)-[-1.5;0;.5]) < 1e-12);
assert(isequal(projectRandom2C([2;2;2],3), ones(3,1)));
rejected = 0;
bad = {@()projectRandom2C([-1;2],1), @()projectRandom2C([NaN;2],1), ...
    @()projectRandom2C([1;2],-1), @()projectRandom2C([1;2],NaN)};
for k = 1:numel(bad)
    try
        bad{k}();
    catch err
        assert(any(strcmp(err.identifier, {'PMTK:ProjectionInput','PMTK:ProjectionRadius'})));
        rejected = rejected+1;
    end
end
assert(rejected == numel(bad));
report.projection = struct('provider', which('projectRandom2C'), ...
    'delegate', which('projectRandom2'), 'cases', size(cases,1), ...
    'maximum_oracle_error', maximum_error, 'maximum_kkt_error', maximum_kkt_error, ...
    'invalid_inputs_rejected', rejected, 'native_executed', false);

% Twelve-state heterogeneous graph, independently enumerated. The oracle is
% E_q[log q-log unnormalized_weight], NOT the exact logZ for a coupled graph.
nStates = [2;3;2];
nodePot = [.6 .4 0; .2 .3 .5; .7 .3 0];
edgePot = zeros(3,3,2);
edgePot(1:2,1:3,1) = [2 1 1.5; .8 2.5 1];
edgePot(1:3,1:2,2) = [1 2; 3 1; 1.5 .7];
edgeStruct = UGM_makeEdgeStruct([0 1 0;1 0 1;0 1 0], nStates, false, 100);
q = [.25 .75 0; .2 .3 .5; .6 .4 0];
[expected_f, exact_logz, exact_node, exact_edge] = enumerate_oracle(nodePot, edgePot, q, nStates);
f = UGM_MFGibbsFreeEnergy(nodePot,edgePot,q,nStates,edgeStruct.edgeEnds,edgeStruct.V,edgeStruct.E);
assert(abs(f-expected_f) < 1e-12 && -f <= exact_logz+1e-12);
q_zero = [1 0 0; 0 .4 .6; .6 .4 0];
zero_expected = enumerate_oracle(nodePot, edgePot, q_zero, nStates);
zero_f = UGM_MFGibbsFreeEnergy(nodePot,edgePot,q_zero,nStates,edgeStruct.edgeEnds,edgeStruct.V,edgeStruct.E);
assert(isfinite(zero_f) && abs(zero_f-zero_expected) < 1e-12);
[mf, mf_edge, mf_logz] = UGM_Infer_MeanField(nodePot,edgePot,edgeStruct);
mf_expected = enumerate_oracle(nodePot, edgePot, mf, nStates);
assert(abs(mf_logz+mf_expected) < 1e-12 && mf_logz <= exact_logz+1e-12);
assert(max(abs(sum(mf,2)-1)) < 1e-12);
for e = 1:2
    joint = mf(e,:)'*mf(e+1,:);
    assert(max(abs(joint(:)-reshape(mf_edge(:,:,e),[],1))) < 1e-12);
end
% One full block is EXACT inference, preserving within-block correlations.
[block, block_edge, block_logz] = UGM_Infer_Block_MF(nodePot,edgePot,edgeStruct,{1:3},@UGM_Infer_Exact);
assert(max(abs(block(:)-exact_node(:))) < 1e-12);
assert(max(abs(block_edge(:)-exact_edge(:))) < 1e-12);
assert(abs(block_logz-exact_logz) < 1e-12);
% Ordinary MF is exact for a factorized graph, even with heterogeneous states.
independent_edges = ones(3,3,2);
[factorized, ~, factorized_logz] = UGM_Infer_MeanField(nodePot,independent_edges,edgeStruct);
expected_factorized = bsxfun(@rdivide,nodePot,sum(nodePot,2));
assert(max(abs(factorized(:)-expected_factorized(:))) < 1e-12);
assert(abs(factorized_logz-sum(log(sum(nodePot,2)))) < 1e-12);
report.ugm = struct('provider', which('UGM_MFGibbsFreeEnergy'), 'native_executed', false, ...
    'states_enumerated', prod(nStates), 'free_energy', f, 'oracle_free_energy', expected_f, ...
    'free_energy_error', abs(f-expected_f), 'zero_belief_error', abs(zero_f-zero_expected), ...
    'meanfield_logz', mf_logz, 'exact_logz', exact_logz, ...
    'meanfield_objective_error', abs(mf_logz+mf_expected), ...
    'full_block_marginal_error', max(abs(block(:)-exact_node(:))), ...
    'full_block_logz_error', abs(block_logz-exact_logz), ...
    'factorized_marginal_error', max(abs(factorized(:)-expected_factorized(:))));
report.passed = true;
fprintf('Projection KKT/ties/zero radius and authentic UGM free-energy/mean-field/block oracles passed.\n');
end

function p = projection_oracle(c, radius)
% Independent sorting oracle; production instead reuses randomized selection.
if isempty(c) || sum(c(:)) <= radius
    p = c;
elseif radius == 0
    p = zeros(size(c));
else
    descending = sort(c(:), 'descend');
    thresholds = (cumsum(descending)-radius)./(1:numel(c))';
    active = find(descending > thresholds, 1, 'last');
    p = max(c-thresholds(active),0);
end
end

function [f, logz, node, edge] = enumerate_oracle(nodePot, edgePot, q, nStates)
weights = zeros(prod(nStates),1);
assignments = zeros(prod(nStates),3);
f = 0;
index = 0;
for a = 1:nStates(1)
    for b = 1:nStates(2)
        for c = 1:nStates(3)
            index = index+1;
            assignments(index,:) = [a b c];
            weight = nodePot(1,a)*nodePot(2,b)*nodePot(3,c)*edgePot(a,b,1)*edgePot(b,c,2);
            mass = q(1,a)*q(2,b)*q(3,c);
            weights(index) = weight;
            if mass > 0
                f = f+mass*(log(mass)-log(weight));
            end
        end
    end
end
logz = log(sum(weights));
weights = weights/sum(weights);
node = zeros(size(nodePot));
edge = zeros(size(edgePot));
for i = 1:numel(weights)
    s = assignments(i,:);
    for n = 1:3, node(n,s(n)) = node(n,s(n))+weights(i); end
    edge(s(1),s(2),1) = edge(s(1),s(2),1)+weights(i);
    edge(s(2),s(3),2) = edge(s(2),s(3),2)+weights(i);
end
end
