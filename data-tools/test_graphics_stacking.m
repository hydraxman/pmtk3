function test_graphics_stacking(root)
warning('off', 'Octave:shadowed-function');
addpath(genpath(fullfile(root, 'matlabTools')));
set(0, 'defaultfigurevisible', 'off');
figure;
hold on;
first = plot([0 1], [0 1]);
middle = plot([0 1], [1 0]);
last = plot([0 1], [0.5 0.5]);
parent = gca;
before = get(parent, 'children');
selected = ismember(before, [first last]);
uistackPMTK([first last], 'bottom');
assert(isequal(get(parent, 'children'), [before(~selected); before(selected)]));
before = get(parent, 'children');
selected = ismember(before, [first last]);
uistackPMTK([last first], 'top');
assert(isequal(get(parent, 'children'), [before(selected); before(~selected)]));
assert(isfinite(get(middle, 'linewidth')));
figure;
foreign = plot([0 1], [0 1]);
rejected = false;
try
    uistackPMTK([first foreign], 'bottom');
catch err
    assert(strcmp(err.identifier, 'PMTK:StackParentMismatch'));
    rejected = true;
end
assert(rejected);
close all;
figure;
z = [0 1; 2 3];
h = surf(z);
setHeightColorsPMTK(h);
assert(isequal(get(h, 'cdata'), z));
assert(strcmp(get(h, 'facecolor'), 'interp'));
close all;
figure;
vertices = [0 0 0; 1 0 1; 1 1 2; 0 1 3];
h = patch('Vertices', vertices, 'Faces', [1 2 3 4]);
setHeightColorsPMTK(h);
assert(isequal(get(h, 'facevertexcdata'), vertices(:,3)));
assert(strcmp(get(h, 'facecolor'), 'interp'));
close all;
fprintf('Portable graphics stacking preserves sibling order and rejects mixed parents.\n');
end
