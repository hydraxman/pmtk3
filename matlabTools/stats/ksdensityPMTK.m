function [density, grid, bandwidth] = ksdensityPMTK(samples)
% Use MATLAB's estimator when available, otherwise PMTK's diffusion KDE.
% The Octave fallback uses Botev's bandwidth selection, not MATLAB's defaults.
if exist('ksdensity', 'file') == 2 || exist('ksdensity', 'builtin') == 5
    if nargout == 0
        ksdensity(samples);
    else
        [density, grid, bandwidth] = ksdensity(samples);
    end
    return;
end
if ~isnumeric(samples) || ~isreal(samples) || ~isvector(samples) ...
        || numel(samples) < 2 || any(~isfinite(samples(:))) ...
        || min(samples(:)) == max(samples(:))
    error('ksdensityPMTK:invalidSamples', 'KDE requires a finite, nonconstant real sample vector.');
end
warning('ksdensityPMTK:diffusionFallback', ...
    'MATLAB ksdensity is unavailable; using PMTK diffusion KDE with Botev bandwidth selection.');
[bandwidth, density, grid] = kde(samples, 4096);
density = density(:)';
grid = grid(:)';
if any(~isfinite(density)) || ~isfinite(bandwidth) || bandwidth <= 0
    error('ksdensityPMTK:estimationFailed', 'Diffusion KDE did not produce a finite density.');
end
if nargout == 0
    plot(grid, density);
end
end
