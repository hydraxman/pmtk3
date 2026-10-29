function demo_lab_probe()
% Environment verification only; never represented as a PMTK demo execution.
attempt = getenv('DEMO_LAB_ATTEMPT');
result = struct('octave_version', version(), 'computer', computer(), 'cwd', pwd(), ...
    'tempdir', tempdir(), 'toolkits', {available_graphics_toolkits()}, 'graphics_ok', false);
functions = {'betapdf', 'normpdf', 'fminunc', 'sqp', 'svmtrain', 'svmpredict', 'print', 'drawnow', 'isOctave'};
for k = 1:numel(functions)
    result.functions.(functions{k}) = which(functions{k});
end
result.runtime = jsondecode(fileread(fullfile(attempt, 'runtime.json')));
failure = [];
try
    % Canonical-absent routing is a no-op, not an environment failure. Test it
    % without renaming/deleting any real support files or changing the path.
    before_path = path();
    absent = demo_lab_route_rosenbrock(fullfile(attempt, 'nonexistent-probe-repo'), ...
                                     fullfile(attempt, 'nonexistent-probe-shims'));
    result.rosenbrock_canonical_absent_ok = ~absent.available && ...
        strcmp(absent.status, 'canonical_source_absent') && strcmp(before_path, path());
    if ~result.rosenbrock_canonical_absent_ok
        error('demo_lab:probe', 'Canonical-absent Rosenbrock routing was not a safe no-op');
    end
    result.libdai_installed = libdaiInstalled();
    result.is_libdai_installed = isLibdaiInstalled();
    if result.libdai_installed ~= result.is_libdai_installed
        error('demo_lab:probe', 'libDAI capability aliases disagree');
    end
    [formatted, formatter_status] = __makeinfo__('Demo lab formatter probe', 'plain text');
    result.makeinfo_status = formatter_status;
    result.makeinfo_text_length = length(formatted);
    if formatter_status ~= 0 || isempty(strfind(formatted, 'Demo lab formatter probe'))
        error('demo_lab:probe', 'Bundled makeinfo formatter failed');
    end
    result.unscoped_makeinfo_blocked = false;
    try
        demo_lab_system('makeinfo --plaintext --output=- "not-a-core-help-call"');
    catch err
        result.unscoped_makeinfo_blocked = strcmp(err.identifier, 'demo_lab:blockedSystem');
    end
    if ~result.unscoped_makeinfo_blocked
        error('demo_lab:probe', 'Unscoped makeinfo request was not blocked');
    end
    result.default_toolkit_before_figure = get(0, 'defaultfigure__graphics_toolkit__');
    figure('visible', 'off');
    result.figure_toolkit_at_creation = get(gcf(), '__graphics_toolkit__');
    plot([0 1 2], [0 1 4], '-o');
    result.figure_toolkit_after_plot = get(gcf(), '__graphics_toolkit__');
    title('Demo lab environment probe (not an original demo)');
    drawnow();
    printPmtkFigure('environment-probe');
    print(fullfile(pwd(), 'probe-original-print.png'), '-dpng');
    result.original_print_ok = exist(fullfile(pwd(), 'probe-original-print.png'), 'file') == 2;
    if ~result.original_print_ok, error('demo_lab:probe', 'Original print hook did not preserve original output'); end
    close(gcf());
    images = dir(fullfile(attempt, 'figures', '*.png'));
    result.graphics_ok = ~isempty(images);
    if ~result.graphics_ok, error('demo_lab:probe', 'No PNG produced by graphics probe'); end
catch err
    result.graphics_error = err.message;
    failure = err;
end
filename = fullfile(attempt, 'probe-output.json');
fid = fopen(filename, 'w');
if fid < 0, error('demo_lab:probe', 'Cannot write probe JSON'); end
fprintf(fid, '%s\n', jsonencode(result));
fclose(fid);
if ~isempty(failure), rethrow(failure); end
end
