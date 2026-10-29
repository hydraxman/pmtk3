function test_static_graphviz(root, output)
warning('off', 'Octave:shadowed-function');
addpath(fullfile(root, 'data-tools'));
addpath(genpath(fullfile(root, 'matlabTools')));
addpath(genpath(fullfile(root, 'pmtkTools')));
if ~exist(output, 'dir'), mkdir(output); end
old = pwd;
restore = onCleanup(@()cd(old));
cd(output);
set(0, 'defaultfigurevisible', 'off');
adj = [0 1 0 0; 0 0 1 0; 0 0 0 0; 0 0 0 0];
plotGraphvizStatic(adj, {'A','B','C','D'}, 'directed', true, 'filename', 'static graph proof');
dot = fileread('static graph proof.dot');
assert(numel(strfind(dot, '->')) == nnz(adj));
for label = {'A','B','C','D'}
    assert(~isempty(regexp(dot, ['label\s*=\s*"' label{1} '"'], 'once')));
end
id = fopen('static graph proof.pdf', 'rb');
assert(id ~= -1);
header = fread(id, 5, 'uint8=>uint8')';
fclose(id);
assert(isequal(header, uint8('%PDF-')));
id = fopen('static graph proof.png', 'rb');
assert(id ~= -1);
header = fread(id, 8, 'uint8=>uint8')';
fclose(id);
assert(isequal(header, uint8([137 80 78 71 13 10 26 10])));
texts = findall(gcf, 'type', 'text');
disclosed = false;
for k = 1:numel(texts)
    text = get(texts(k), 'string');
    disclosed = disclosed || (ischar(text) && ~isempty(strfind(text, 'MATLAB graph-object editing unavailable')));
end
assert(disclosed);
plotGraphvizStatic(adj+adj', {'A','B','C','D'}, 'directed', false, ...
    'engine', 'circo', 'filename', 'undirected graph proof');
dot = fileread('undirected graph proof.dot');
assert(numel(strfind(dot, '--')) == nnz(adj));
plotGraphvizStatic(zeros(1), {'WIDE HORIZONTAL LABEL'}, ...
    'landscape', true, 'filename', 'upright preview proof');
pixels = imread('upright preview proof.png');
assert(size(pixels, 2) > size(pixels, 1));
close all;
fprintf('Static graph preserves nodes/edges, real PDF/PNG exports, upright previews, spaced paths and renderer disclosure.\n');
end
