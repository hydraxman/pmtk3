function demo_lab_main()
% Execute one original source in a disposable process; never initialize PMTK.
mlock;
more off;
page_screen_output(false);
pause('off');
exit_code = 1;
payload = struct('success', false, 'completed', false, ...
                 'source', getenv('DEMO_LAB_SOURCE_ID'));
try
    % Defense against a stale Python inventory/caller: this original's first
    % Octave branch is only a MATLAB-only notice + return, NOT an execution.
    % Inspect before setup/invocation; do not call the disabled source at all.
    demo_lab_preflight();
    metadata = demo_lab_setup();
    demo_lab_write_json(fullfile(getenv('DEMO_LAB_ATTEMPT'), 'runtime.json'), metadata);
    demo_lab_invoke();
    payload.success = true;
    exit_code = 0;
catch err
    payload.error = struct('identifier', err.identifier, 'message', err.message, 'stack', err.stack);
    if strcmp(err.identifier, 'demo_lab:unsupported')
        payload.status = 'unsupported';
        payload.workload_executed = false;
        payload.execution_disposition = 'not_executed';
        payload.requirement = 'MATLAB memmapfile';
        exit_code = 3;
    elseif any(strcmp(err.identifier, {'PMTK:MissingLibdai', 'PMTK:MissingNativeDependency'})) && ...
            demo_lab_leading_dependency_guard(err)
        % An explicit leading dependency guard ran, but no numerical workload.
        % Preserve the original identifier/message/stack rather than a pass or
        % an invented native backend. Use the existing unsupported protocol.
        payload.status = 'unsupported';
        payload.workload_executed = false;
        payload.execution_disposition = 'dependency_unavailable';
        if strcmp(err.identifier, 'PMTK:MissingLibdai')
            payload.requirement = 'native libDAI MEX extension (optional dependency)';
        else
            payload.requirement = err.message;
        end
        exit_code = 3;
    end
    fprintf(2, '\nDEMO-LAB ERROR [%s]: %s\n', err.identifier, err.message);
    for k = 1:numel(err.stack)
        fprintf(2, '  %s:%d (%s)\n', err.stack(k).file, err.stack(k).line, err.stack(k).name);
    end
    % Preserve source status/error BEFORE final rendering, which itself can hang.
    payload.phase = 'final_capture';
    try
        demo_lab_write_json(fullfile(getenv('DEMO_LAB_ATTEMPT'), 'octave-state.json'), payload);
    catch err
        fprintf(2, 'DEMO-LAB checkpoint failed: %s\n', err.message);
    end
end
% The demo may have cleared its workspace, closed figures or changed cwd.
% Environment variables and root graphics appdata survive clear all.
try
    handles = findall(0, 'type', 'figure');
    for k = 1:numel(handles)
        demo_lab_capture(handles(k), 'remaining');
    end
catch err
    fprintf(2, 'DEMO-LAB final capture error: %s\n', err.message);
end
if isappdata(0, 'demo_lab_capture_errors')
    payload.capture_errors = getappdata(0, 'demo_lab_capture_errors');
else
    payload.capture_errors = {};
end
try
    payload.completed = true;
    payload.phase = 'completed';
    demo_lab_write_json(fullfile(getenv('DEMO_LAB_ATTEMPT'), 'octave-result.json'), payload);
catch err
    fprintf(2, 'DEMO-LAB result serialization failed: %s\n', err.message);
    exit_code = 2;
end
% Bypass our exit/quit guards. This is the only intentional process exit.
builtin('exit', exit_code);
end

function demo_lab_preflight()
if ~strcmp(getenv('DEMO_LAB_ENTRY'), 'memoryMapDemo'), return; end
text = fileread(getenv('DEMO_LAB_SOURCE'));
text = regexprep(text, '(?m)^[ \t]*%[^\r\n]*(\r?\n|$)', '');
text = regexprep(text, '^\s*function[^\r\n]*(\r?\n|$)', '');
pattern = ['^\s*if[ \t]+isOctave[ \t]*\([ \t]*\)[ \t]*[\r\n,;]+' ...
           '\s*fprintf\([^\r\n]*\)[ \t]*;?\s*return[ \t]*[\r\n;]+\s*end([ \t\r\n;]|$)'];
% Avoid \b: Octave's string/regexp escape handling treats it as backspace.
if ~isempty(regexp(text, pattern, 'once')) && ...
        ~isempty(regexp(text, '(^|[^A-Za-z0-9_])memmapfile[ \t]*\(', 'once'))
    error('demo_lab:unsupported', ...
          'Requires MATLAB memmapfile; leading isOctave() return prevents the demo workload. Source was not invoked.');
end
end

function answer = demo_lab_leading_dependency_guard(err)
answer = false;
if isempty(err.stack), return; end
source = canonicalize_file_name(getenv('DEMO_LAB_SOURCE'));
origin = canonicalize_file_name(err.stack(1).file);
source = strrep(source, '\', '/'); origin = strrep(origin, '\', '/');
if ispc(), source = lower(source); origin = lower(origin); end
if isempty(source) || ~strcmp(source, origin), return; end
text = fileread(getenv('DEMO_LAB_SOURCE'));
% Retain newlines so the matched guard can be tied to the ACTUAL error line.
text = regexprep(text, '(?m)^[ \t]*%[^\r\n]*', '');
text = regexprep(text, '(?m)^[ \t]*function[^\r\n]*', '');
if strcmp(err.identifier, 'PMTK:MissingLibdai')
    pattern = ['^\s*if[ \t]+~[ \t]*isLibdaiInstalled[ \t]*\([ \t]*\)[ \t]*[\r\n,;]+' ...
               '\s*error[ \t]*\([ \t]*''PMTK:MissingLibdai'''];
elseif strcmp(err.identifier, 'PMTK:MissingNativeDependency')
    % Only an explicit FIRST executable native-presence guard is a no-work
    % dependency outcome. Undefined functions or later failures stay failures.
    pattern = ['^\s*if[ \t]+exist[ \t]*\([ \t]*''[A-Za-z][A-Za-z0-9_]*''[ \t]*,' ...
               '[ \t]*''file''[ \t]*\)[ \t]*~=[ \t]*3[ \t]*[\r\n,;]+' ...
               '\s*error[ \t]*\([ \t]*''PMTK:MissingNativeDependency'''];
else
    return;
end
[~, finish] = regexp(text, pattern, 'once');
if ~isempty(finish)
    guard_error_line = 1 + sum(text(1:finish) == char(10));
    answer = err.stack(1).line == guard_error_line;
end
end

function demo_lab_write_json(filename, value)
text = jsonencode(value);
tmp = [filename '.tmp'];
fid = fopen(tmp, 'w');
if fid < 0, error('demo_lab:write', 'Cannot open %s', tmp); end
try
    fprintf(fid, '%s\n', text);
catch err
    fclose(fid);
    rethrow(err);
end
fclose(fid);
[status, message] = rename(tmp, filename);
if status ~= 0, error('demo_lab:write', '%s', message); end
end
