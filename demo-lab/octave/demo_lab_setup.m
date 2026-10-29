function metadata = demo_lab_setup()
% Load packages FIRST, then preserve selected ORIGINAL PMTK semantics ahead of
% similarly named package/core APIs. Support libraries remain appended; do not
% broadly prepend old support packages. Compiled built-ins are protected below.
% No restoredefaultpath/init/download calls.
mlock;
repo = getenv('DEMO_LAB_REPO');
attempt = getenv('DEMO_LAB_ATTEMPT');
lab = fileparts(mfilename('fullpath'));
started = time();
metadata = struct('octave_version', version(), 'computer', computer(), ...
    'working_directory', pwd(), 'source', getenv('DEMO_LAB_SOURCE'), ...
    'path_policy', 'packages loaded first; PMTK semantic-contract dirs promoted; support appended; lab/builtin guards first');
% Older imported Python runners do not export this newer environment variable.
% Resolve the ACTUAL running Octave binary locally for the scoped formatter.
if isempty(getenv('DEMO_LAB_OCTAVE'))
    executable = canonicalize_file_name(program_invocation_name());
    if isempty(executable)
        bin = __octave_config_info__('bindir');
        for name = {'octave-cli.exe', 'octave.exe', 'octave-cli', 'octave'}
            candidate = canonicalize_file_name(fullfile(bin, name{1}));
            if ~isempty(candidate), executable = candidate; break; end
        end
    end
    if ~isempty(executable), setenv('DEMO_LAB_OCTAVE', executable); end
    metadata.runtime_executable_compatibility_default = true;
else
    metadata.runtime_executable_compatibility_default = false;
end
metadata.runtime_executable = getenv('DEMO_LAB_OCTAVE');
[~, executable_name, ~] = fileparts(metadata.runtime_executable);
if strcmpi(executable_name, 'octave-gui')
    metadata.runtime_frontend = 'GUI-linked executable with --no-gui';
else
    metadata.runtime_frontend = 'console executable';
end
metadata.qt_environment = struct('QT_QPA_PLATFORM', getenv('QT_QPA_PLATFORM'), ...
    'QT_OPENGL', getenv('QT_OPENGL'), 'QT_PLUGIN_PATH', getenv('QT_PLUGIN_PATH'), ...
    'QT_QPA_PLATFORM_PLUGIN_PATH', getenv('QT_QPA_PLATFORM_PLUGIN_PATH'));
requested = strsplit(getenv('DEMO_LAB_PACKAGES'), ',');
available = pkg('list');
loaded = {};
package_records = {};
for k = 1:numel(requested)
    name = requested{k};
    if isempty(name), continue; end
    record = struct('name', name, 'available', false, 'loaded', false, 'version', '', 'error', '');
    for j = 1:numel(available)
        item = available{j};
        if strcmp(item.name, name)
            record.available = true;
            record.version = item.version;
        end
    end
    if record.available
        try
            pkg('load', name);
            record.loaded = true;
            loaded{end+1} = name;
        catch err
            record.error = err.message;
            fprintf(2, 'DEMO-LAB package %s failed: %s\n', name, err.message);
        end
    else
        record.error = 'not installed; no download attempted';
        fprintf('DEMO-LAB package %s not installed\n', name);
    end
    package_records{end+1} = record;
end
metadata.packages = package_records;
metadata.available_packages = available;
plan = jsondecode(fileread(fullfile(attempt, 'path-plan.json')));
% Long-running Python coordinators may retain an older path-plan producer.
% Derive new semantic fields locally before accessing them; never require a
% parent restart merely because the Octave harness was updated mid-batch.
[plan, compatibility_defaults] = demo_lab_complete_path_plan(plan, repo);
metadata.path_plan_compatibility_defaults = compatibility_defaults;
added = plan.directories;
skipped = plan.skipped;
fprintf('DEMO-LAB setup: %d curated paths; packages loaded in %.3fs\n', numel(added), time()-started);
fflush(stdout);
% A single addpath avoids repeated full path recaching on Windows.
previous_shadow_warning = warning('query', 'Octave:shadowed-function');
warning('off', 'Octave:shadowed-function');
addpath(strjoin(added, pathsep()), '-end');
% normalize() is NOT Octave's column-wise standardization API. PMTK requires
% whole-array probability normalization with a scalar partition constant.
% Promote only trusted original PMTK directories, never an entire old support
% tree. Cached package functions must be re-resolved after the path change.
addpath(strjoin(plan.preferred_directories, pathsep()), '-begin');
clear normalize logsumexp process_options gaussLogprob;
warning(previous_shadow_warning.state, 'Octave:shadowed-function');
shims = fullfile(attempt, 'shims');
mkdir(shims);
% Octave gives an .m file precedence over a compiled built-in EVEN when its
% directory was appended. Protect only actual built-ins with explicit wrappers;
% this avoids PMTK util/islower.m, isupper.m etc breaking core internals.
protected = {};
for k = 1:numel(plan.candidate_function_names)
    name = plan.candidate_function_names{k};
    if exist(name, 'builtin') == 5 && ~any(strcmp(name, {'drawnow', 'system', 'exit', 'quit', ...
                                                      'normalize', 'logsumexp', 'process_options', 'gaussLogprob'}))
        fid = fopen(fullfile(shims, [name '.m']), 'w');
        if fid < 0, error('demo_lab:shim', 'Cannot protect builtin %s', name); end
        fprintf(fid, 'function varargout = %s(varargin)\n[varargout{1:nargout}] = builtin(''%s'', varargin{:});\nend\n', name, name);
        fclose(fid);
        protected{end+1} = name;
    end
end
demo_lab_helper(shims, 'isOctave', true);
toolboxes = {'stats', 'bioinfo', 'optim', 'signal', 'images', 'symbolic', 'nnet', 'splines'};
octave_pkgs = {'statistics', 'bioinfo', 'optim', 'signal', 'image', 'symbolic', 'nnet', 'splines'};
for k = 1:numel(toolboxes)
    demo_lab_helper(shims, [toolboxes{k} 'ToolboxInstalled'], any(strcmp(loaded, octave_pkgs{k})));
end
% Preserve the existing PMTK capability predicate. Only the obsolete spelling
% is bridged by hooks/libdaiInstalled.m; do not shadow the original predicate.
dai_file = which('dai');
dai_native = isLibdaiInstalled();
metadata.libdai = struct('available', dai_native, 'origin', dai_file, ...
    'predicate_origin', which('isLibdaiInstalled'), 'native_extension', mexext());
% Explicit process exits and global PMTK initializers must not bypass result
% serialization or rewrite original generated files. Static inventory also
% blocks direct OS calls; these guards catch common indirect calls.
guarded = {'exit', 'quit', 'system', 'unix', 'dos', 'initPmtk3', ...
           'initPmtk3Octave', 'downloadAllSupport', 'urlwrite', 'urlread', 'webread', 'websave'};
for k = 1:numel(guarded)
    filename = fullfile(shims, [guarded{k} '.m']);
    fid = fopen(filename, 'w');
    if fid < 0, error('demo_lab:shim', 'Cannot write %s', filename); end
    fprintf(fid, 'function varargout = %s(varargin)\n', guarded{k});
    if any(strcmp(guarded{k}, {'system', 'unix', 'dos'}))
        % Octave's own PNG exporter invokes renderer/font/Ghostscript tools.
        % Permit these only while OUR capture function is actively exporting;
        % ordinary source/support system calls still fail explicitly.
        fprintf(fid, '[varargout{1:nargout}] = demo_lab_system(varargin{:});\nreturn;\n');
    end
    fprintf(fid, 'error(''demo_lab:blocked'', ''Blocked process/OS/download/init operation: %s'');\nend\n', guarded{k});
    fclose(fid);
end
% Bind before adding the print hook; capture must call this original handle
% directly rather than resolving print() again and recursing.
setappdata(0, 'demo_lab_original_print', @print);
addpath(fullfile(lab, 'hooks'), '-begin');
addpath(shims, '-begin');
% Derived locally, not from new manifest fields: cached Python producers work.
metadata.rosenbrock_route = demo_lab_route_rosenbrock(repo, shims);
metadata.added_directories = added;
metadata.skipped_directories = skipped;
metadata.protected_compiled_builtins = protected;
metadata.preferred_directories = plan.preferred_directories;
% Persist expected/actual origins even if a contract fails, then refuse to
% invoke the source rather than silently computing with another algorithm.
metadata.numerical_contracts = demo_lab_check_origins(plan, attempt);
metadata.libsvm_policy = 'Support libsvm directories omitted unless selected source mentions svm/libsvm; core/packages still precede support';
metadata.toolbox_helper_policy = 'Package loaded flag only; not a promise of complete MATLAB toolbox compatibility';
metadata.guarded_operations = guarded;
metadata.system_guard_exception = 'Lab PNG/original print; constrained Graphviz/gnuplot; pinned bundled makeinfo only from core formatter with safe arguments and attempt-local input';
metadata.graphics_toolkits = available_graphics_toolkits();
preferred = getenv('DEMO_LAB_TOOLKIT');
metadata.graphics_error = '';
if any(strcmp(metadata.graphics_toolkits, preferred))
    graphics_toolkit(preferred);
elseif ~isempty(metadata.graphics_toolkits)
    if any(strcmp(metadata.graphics_toolkits, 'gnuplot'))
        graphics_toolkit('gnuplot');
    else
        graphics_toolkit(metadata.graphics_toolkits{1});
    end
    metadata.graphics_error = ['Requested toolkit unavailable: ' preferred];
else
    metadata.graphics_error = 'No graphics toolkit available; visual demos may fail';
end
metadata.graphics_toolkit = graphics_toolkit();
if strcmp(metadata.graphics_toolkit, 'qt')
    % A default for NEW/reset figures, not conversion of existing objects.
    set(0, 'defaultfigure__graphics_toolkit__', 'qt');
end
metadata.default_figure_toolkit = get(0, 'defaultfigure__graphics_toolkit__');
setappdata(0, 'demo_lab_toolkit', metadata.graphics_toolkit);
setappdata(0, 'demo_lab_capture_index', 0);
setappdata(0, 'demo_lab_capture_errors', {});
setappdata(0, 'demo_lab_capture_busy', false);
set(0, 'defaultfigurevisible', 'off');
% CloseRequestFcn captures before destruction, then deletes directly (never
% calls close). DeleteFcn is a fallback for close force/direct deletes. Both
% suppress duplicate captures during the same close; no close recursion.
set(0, 'defaultfigurecloserequestfcn', @(h, event) demo_lab_close(h));
set(0, 'defaultfiguredeletefcn', @(h, event) demo_lab_capture(h, 'delete'));
metadata.capture_policy = 'print + close/delete + drawnow + remaining; declared toolkit except modern scatter retains native OpenGL backend; hard-blocked computations/callback resets/clear figure can lose frames';
metadata.resolved_helpers = struct('isOctave', which('isOctave'), ...
    'statsToolboxInstalled', which('statsToolboxInstalled'), ...
    'libdaiInstalled', which('libdaiInstalled'), 'isLibdaiInstalled', which('isLibdaiInstalled'), ...
    'printPmtkFigure', which('printPmtkFigure'), 'close', which('close'));
metadata.resolved_numerics = struct('mean', which('mean'), 'std', which('std'), ...
    'svmtrain', which('svmtrain'), 'svmpredict', which('svmpredict'), ...
    'fminunc', which('fminunc'), 'normalize', which('normalize'), ...
    'logsumexp', which('logsumexp'), 'process_options', which('process_options'), ...
    'gaussLogprob', which('gaussLogprob'), 'print', which('print'));
metadata.path = path();
metadata.setup_seconds = time()-started;
fprintf('DEMO-LAB Octave %s, graphics %s, source %s\n', ...
    version(), metadata.graphics_toolkit, getenv('DEMO_LAB_SOURCE_ID'));
end

function demo_lab_helper(folder, name, answer)
filename = fullfile(folder, [name '.m']);
fid = fopen(filename, 'w');
if fid < 0, error('demo_lab:shim', 'Cannot write %s', filename); end
fprintf(fid, 'function answer = %s()\nanswer = logical(%d);\nend\n', name, answer);
fclose(fid);
end
