function printPmtkFigure(varargin)
% Lab-only redirect of legacy PDF exports (which otherwise use pdfcrop/shells).
% Requested filenames/formats do not control output paths; source is unchanged.
handles = findall(0, 'type', 'figure');
if isempty(handles)
    fprintf(2, 'DEMO-LAB printPmtkFigure called without a figure\n');
    return;
end
demo_lab_capture(gcf(), 'printPmtkFigure');
end
