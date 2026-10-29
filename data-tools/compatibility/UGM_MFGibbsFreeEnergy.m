% Copyright 2005-2015 Mark Schmidt. All rights reserved.
%
% Redistribution and use in source and binary forms, with or without
% modification, are permitted provided that the following conditions are met:
% 1. Redistributions of source code must retain the above copyright notice,
%    this list of conditions and the following disclaimer.
% 2. Redistributions in binary form must reproduce the above copyright
%    notice, this list of conditions and the following disclaimer in the
%    documentation and/or other materials provided with the distribution.
%
% THIS SOFTWARE IS PROVIDED BY THE AUTHOR ''AS IS'' AND ANY EXPRESS OR IMPLIED
% WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
% MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
% EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
% INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
% NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
% DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
% OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
% NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
% EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
%
% Recovered from https://www.cs.ubc.ca/~schmidtm/Software/UGM_2011.zip
% member UGM/sub/UGM_MFGibbsFreeEnergy.m. Original mathematical body retained;
% declared name corrected from MFGibbsFreeEnergy to match its public filename.
% License: https://www.cs.ubc.ca/~schmidtm/Software/copyright.html
function [F] = UGM_MFGibbsFreeEnergy(nodePot,edgePot,nodeBel,nStates,edgeEnds,V,E)

[nNodes,maxState] = size(nodePot);
nEdges = size(edgeEnds,1);

threshold = 1e-10;

U1 = 0;
U2 = 0;
S1 = 0;

for n = 1:nNodes
    % Local Mean-Field Average Energy Term
    b = nodeBel(n,1:nStates(n));
    U1 = U1 + sum(b .* log(nodePot(n,1:nStates(n))));

    % Mean-Field Entropy Term
    b = nodeBel(n,1:nStates(n));
    b(b < threshold) = 1;
    S1 = S1 + sum(b.* log(b));
end

for e = 1:nEdges
    n1 = edgeEnds(e,1);
    n2 = edgeEnds(e,2);

    b_i = repmat(nodeBel(n1,1:nStates(n1))',1,nStates(n2));
    b_j = repmat(nodeBel(n2,1:nStates(n2)),nStates(n1),1);
    pot_ij = edgePot(1:nStates(n1),1:nStates(n2),e);

    % Pairwise Mean-Field Average Energy Term
    U2 = U2 + sum(b_i(:).*b_j(:).*log(pot_ij(:)));
end

F = - U2 - U1 + S1;
end
