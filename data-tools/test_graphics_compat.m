function test_graphics_compat(root)
warning('off', 'Octave:shadowed-function');
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
set(0, 'defaultfigurevisible', 'off');
values = [-1 0; 0.5 1];
weights = [0.2 0.4; 0.6 0.8];
figure;
hintonScale({values, weights}, {'map', 'jet'}, ...
    {values/2, weights/2}, {'map', 'jet'});
suptitle('Shared-scale Hinton diagrams');
assert(numel(findobj(gcf, 'type', 'patch')) == 8);
note = annotation(gcf, 'textbox', [0.1 0.1 0.3 0.1], ...
    'string', 'Annotation', 'fontweight', 'bold');
assert(strcmp(get(note, 'fontweight'), 'bold'));
close all;
hintonScaleMulti({values, weights}, {'map', 'jet'}, ...
    {values/2, weights/2}, {'map', 'jet'});
figures = findall(0, 'type', 'figure');
populated = 0;
for i = 1:numel(figures)
    if numel(findobj(figures(i), 'type', 'patch')) == 4
        populated = populated + 1;
    end
end
assert(populated == 2);
close all;
figure;
histo([-2 -1 0 1 2], 4, 0, 1);
traces = findobj(gca, 'type', 'line');
area = 0;
for i = 1:numel(traces)
    area = max(area, trapz(get(traces(i), 'xdata'), get(traces(i), 'ydata')));
end
assert(abs(area-1) < 1e-12);
assert(~ishold(gca));
close all;
figure;
bars = errorbar([1 2], [0.4 0.8], [0.1 0.2], 'ko-');
set(bars, 'linewidth', 2, 'markersize', 12);
assert(get(bars, 'linewidth') == 2 && get(bars, 'markersize') == 12);
lowerErrors = get(bars, 'ldata');
assert(isequal(lowerErrors(:), [0.1;0.2]));
close all;
figure;
box = annotation(gcf, 'textbox', [0.1 0.1 0.2 0.1], ...
    'string', 'Formula', 'FitBoxToText', 'off');
assert(isequal(get(box, 'position'), [0.1 0.1 0.2 0.1]));
arrow = annotation(gcf, 'doublearrow', [0.2 0.8], [0.5 0.5], ...
    'Head1Length', 3, 'Head2Length', 3);
assert(get(arrow, 'Head1Length') == 3 && get(arrow, 'Head2Length') == 3);
close all;
figure;
surface = surf([0 1; 0 1], [0 0; 1 1], [0 1; 1 0]);
camlight right;
lastwarn('');
lightingPMTK('phong');
[~, identifier] = lastwarn;
assert(strcmp(identifier, 'PMTK:PhongUnavailable'));
assert(strcmp(get(surface, 'facelighting'), 'gouraud'));
close all;
fprintf('Shared graphics, histogram normalization and error-bar data tests passed.\n');
end
