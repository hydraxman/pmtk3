function y = quantilePMTK(X, p)
% Simple replacement for the stats quantile function
% Covers most but possibly not all use cases

% This file is from pmtk3.googlecode.com

if ~isnumeric(X) || ~isreal(X) || isempty(X) || any(~isfinite(X(:)))
    error('quantilePMTK:invalidSamples', 'Samples must be finite, nonempty real numeric data.');
end
if ~isnumeric(p) || ~isreal(p) || any(~isfinite(p(:))) || any(p(:) < 0 | p(:) > 1)
    error('quantilePMTK:invalidProbabilities', 'Probabilities must be finite values between zero and one.');
end
X = sort(X(:), 1);
n = length(X);
q = [0 100*(0.5:(n-0.5))./n 100]';
y = interp1(q, [X(1); X; X(end)], 100.*p(:), 'linear');

end
