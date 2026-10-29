function p = projectRandom2C(c, lambda)
% Compatibility entry for the original nonnegative L1-ball projection.
% Reuses Mark Schmidt's existing, tie-aware projectRandom2.m unchanged.
% A recognized same-directory native MEX retains MATLAB/Octave file priority;
% this file never compiles or attempts to load an incompatible native binary.
% Upstream: https://www.cs.ubc.ca/~schmidtm/Software/PQN.html
if ~isa(c, 'double') || ~isreal(c) || issparse(c) || ...
        (~isvector(c) && ~isempty(c)) || any(~isfinite(c(:))) || any(c(:) < 0)
    error('PMTK:ProjectionInput', 'Input must be a full real nonnegative finite double vector.');
end
if ~isnumeric(lambda) || ~isreal(lambda) || ~isscalar(lambda) || isnan(lambda) || lambda < 0
    error('PMTK:ProjectionRadius', 'L1 radius must be a nonnegative real scalar.');
end
if lambda == 0
    p = zeros(size(c));
elseif isempty(c) || sum(c(:)) <= lambda
    p = c;
else
    p = reshape(projectRandom2(c(:), lambda), size(c));
end
end
