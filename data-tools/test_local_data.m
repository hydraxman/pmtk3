function test_local_data(root)
addpath(root);
addpath(fullfile(root, 'pmtkTools', 'dataTools'));
addpath(genpath(fullfile(root, 'matlabTools', 'util')));
folder = tempname();
mkdir(folder);
cleanup = onCleanup(@() rmdir(folder, 's'));
value = 42;
save(fullfile(folder, 'one.mat'), 'value');
foo = 7; bar = 9;
save(fullfile(folder, 'multiple.mat'), 'foo', 'bar');
addpath(folder);
assert(loadData('one') == 42);
loaded = loadData('multiple');
assert(loaded.foo == 7 && loaded.bar == 9);
clear foo bar;
loadData('multiple');
assert(foo == 7 && bar == 9);
assert(strcmp(loadData(folder, 'isMatFile', false), folder));
images = loadData('pmtkImages', 'isMatFile', false);
assert(exist(fullfile(images, 'digit6.png'), 'file') == 2);
assert(strcmp(loadFolder(folder), folder));
assert(strcmp(loadFolder('pmtkImages'), images));
caught = false;
try
    loadData('missing-pmtk-directory-fixture', 'isMatFile', false);
catch err
    caught = strcmp(err.identifier, 'loadData:directoryNotFound');
end
assert(caught);
rmpath(folder);
fprintf('Local MAT and directory dataset tests passed.\n');
end
