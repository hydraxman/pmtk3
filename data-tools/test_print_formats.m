function test_print_formats(root)
addpath(genpath(fullfile(root, 'matlabTools')));
folder = tempname;
handle = figure('visible', 'off');
graphics_toolkit(handle, 'gnuplot');
plot([0 1], [1 0]);
printPmtkFigure('png-output', 'png', folder);
printPmtkFigure('pdf-output', 'pdf', folder);
close(gcf);
file = fopen(fullfile(folder, 'png-output.png'), 'rb');
assert(file >= 0);
signature = fread(file, 8, 'uint8')';
fclose(file);
assert(isequal(signature, [137 80 78 71 13 10 26 10]));
file = fopen(fullfile(folder, 'pdf-output.pdf'), 'rb');
assert(file >= 0);
signature = char(fread(file, 5, 'uint8')');
fclose(file);
assert(strcmp(signature, '%PDF-'));
delete(fullfile(folder, 'png-output.png'));
delete(fullfile(folder, 'pdf-output.pdf'));
rmdir(folder);
fprintf('Native PMTK PNG/PDF export signature tests passed.\n');
end
