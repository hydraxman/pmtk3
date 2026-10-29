function lightingPMTK(method)
useFallback = exist('OCTAVE_VERSION', 'builtin') ~= 0 && ischar(method) && strcmpi(method, 'phong');
if useFallback
    method = 'gouraud';
end
lighting(method);
if useFallback
    warning('PMTK:PhongUnavailable', 'Octave does not support Phong lighting; using Gouraud shading.');
end
end
