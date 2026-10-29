function test_ugm(root)
warning('off', 'Octave:shadowed-function');
addpath(root);
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'toolbox')));
addpath(genpath(fullfile(root, 'pmtkTools')));
addpath(genpath(fullfile(root, 'pmtksupportCopy', 'packages')), '-end');
nodePot = [0.6 0.4; 0.3 0.7; 0.8 0.2];
edgePot = [2 1; 1 3];
adj = chainAdjMatrix(3);
direct = UGM_makeEdgeStruct(adj, 2);
assert(~direct.useMex);
explicitNative = UGM_makeEdgeStruct(adj, 2, true);
assert(explicitNative.useMex);
features = ones(1, 1, 3);
edgeFeatures = ones(1, 1, 2);
info = UGM_makeCRFInfoStruct(features, edgeFeatures, direct, false, false);
[w, ~] = UGM_initWeights(info, @ones);
potentials = UGM_makeCRFNodePotentials(features, w, direct, info);
assert(max(abs(potentials(:,1)-exp(1))) < 1e-12);
assert(isequal(potentials(:,2), ones(3,1)));
[labels, generatedAdj] = UGM_generate(4, 1, 3, adj, 2, 0, 0, 1, 4);
assert(isequal(size(labels), [4 3]) && isequal(generatedAdj, adj));
assert(all(labels(:) >= 1 & labels(:) <= 2));
defaults = mrf2Create(adj, 2, 'method', 'Chain');
assert(~defaults.edgeStruct.useMex);
model = mrf2Create(adj, 2, 'nodePot', nodePot, 'edgePot', edgePot, ...
    'method', 'Chain', 'useMex', false);
[actual, ~, logZ] = mrf2InferNodesAndEdges(model);
states = ind2subv([2 2 2], 1:8);
weights = zeros(8, 1);
for i = 1:8
    s = states(i, :);
    weights(i) = nodePot(1,s(1))*nodePot(2,s(2))*nodePot(3,s(3)) ...
        *edgePot(s(1),s(2))*edgePot(s(2),s(3));
end
expected = zeros(3, 2);
for node = 1:3
    for state = 1:2
        expected(node, state) = sum(weights(states(:,node)==state))/sum(weights);
    end
end
assert(max(abs(actual(:)-expected(:))) < 1e-10);
assert(abs(logZ-log(sum(weights))) < 1e-10);
model = crf2Create(adj, 2, 'method', 'Chain', 'useMex', false);
y = [1 1 1; 1 1 2; 1 2 1; 2 2 2; 2 1 1; 1 2 2];
Xnode = ones(6, 1, 3);
Xedge = ones(6, 1, 2);
model = crf2Train(model, Xnode, Xedge, y, 'lambdaNode', 1, 'lambdaEdge', 1);
assert(all(isfinite(model.w(:))));
assert(all(isfinite(model.v(:))));
beliefs = crf2InferNodesAndEdges(model, Xnode(1,:,:), Xedge(1,:,:));
assert(max(abs(sum(beliefs, 2)-1)) < 1e-10);
fprintf('Pure MATLAB UGM exact-enumeration and CRF training tests passed.\n');
end
