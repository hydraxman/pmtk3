function varargout = demo_lab_system(varargin)
% Rendering by Octave's own PNG exporter is explicitly scoped. Other source
% OS calls are denied except constrained Graphviz/version-only gnuplot calls.
if (isappdata(0, 'demo_lab_capture_busy') && getappdata(0, 'demo_lab_capture_busy')) || ...
        (isappdata(0, 'demo_lab_original_render_busy') && getappdata(0, 'demo_lab_original_render_busy'))
    [varargout{1:nargout}] = builtin('system', varargin{:});
    return;
end
if isempty(varargin) || ~ischar(varargin{1})
    error('demo_lab:blockedSystem', 'Nonliteral/dynamic OS request denied');
end
command = strtrim(varargin{1});
if ~isempty(regexp(command, '[;&|`$%^!\r\n<>]', 'once'))
    error('demo_lab:blockedSystem', 'Shell operators/expansions are not permitted: %s', command);
end
tokens = regexp(command, '"[^"]*"|''[^'']*''|[^\s]+', 'match');
if isempty(tokens), error('demo_lab:blockedSystem', 'Empty OS command'); end
for k = 1:numel(tokens)
    if length(tokens{k}) >= 2 && any(tokens{k}(1) == ['"' ''''])
        tokens{k} = tokens{k}(2:end-1);
    end
end
[~, executable, ext] = fileparts(tokens{1});
if ~isempty(ext) && ~strcmpi(ext, '.exe') && ~(strcmpi(executable, 'makeinfo') && strcmpi(ext, '.bat'))
    error('demo_lab:blockedSystem', 'Unexpected executable suffix');
end
if strcmpi(executable, 'makeinfo')
    command = demo_lab_makeinfo_command(tokens);
elseif strcmpi(executable, 'gnuplot')
    if numel(tokens) ~= 2 || ~strcmp(tokens{2}, '--version')
        error('demo_lab:blockedSystem', 'Gnuplot scripts are allowed only through the lab PNG exporter');
    end
elseif any(strcmpi(executable, {'dot', 'neato', 'fdp', 'sfdp', 'twopi', 'circo'}))
    k = 2;
    while k <= numel(tokens)
        value = tokens{k};
        if strcmp(value, '-o')
            k = k + 1;
            if k > numel(tokens), error('demo_lab:blockedSystem', 'Missing Graphviz output'); end
            demo_lab_local_output(tokens{k});
        elseif strncmp(value, '-o', 2)
            demo_lab_local_output(value(3:end));
        elseif value(1) == '-'
            if ~strcmp(value, '-Gconcentrate') && isempty(regexp(value, '^(-T[A-Za-z0-9:]+|-K[A-Za-z]+|-G[^=]+=[A-Za-z0-9_.-]+|-(Nfontsize|Earrowsize|Epenwidth)=[0-9]+(\.[0-9]+)?|--version|-V)$', 'once'))
                error('demo_lab:blockedSystem', 'Unreviewed Graphviz option: %s', value);
            end
        else
            % Graphviz input can be original repo data or an attempt-local file.
            input = canonicalize_file_name(value);
            roots = {canonicalize_file_name(getenv('DEMO_LAB_REPO')), canonicalize_file_name(getenv('DEMO_LAB_ATTEMPT'))};
            good = false;
            for j = 1:numel(roots)
                input2 = strrep(input, '\', '/'); root = strrep(roots{j}, '\', '/');
                if ispc(), input2 = lower(input2); root = lower(root); end
                good = good || (~isempty(input2) && strncmp(input2, [root '/'], length(root)+1));
            end
            if ~good, error('demo_lab:blockedSystem', 'Graphviz input is outside repo/attempt: %s', value); end
        end
        k = k + 1;
    end
else
    error('demo_lab:blockedSystem', 'Unreviewed external executable: %s', executable);
end
fprintf('DEMO-LAB reviewed external renderer: %s\n', command);
[varargout{1:nargout}] = builtin('system', varargin{:});
end

function demo_lab_local_output(value)
candidate = make_absolute_filename(value);
parent = strrep(canonicalize_file_name(fileparts(candidate)), '\', '/');
root = strrep(canonicalize_file_name(getenv('DEMO_LAB_ATTEMPT')), '\', '/');
if ispc(), parent = lower(parent); root = lower(root); end
if isempty(parent) || ~(strcmp(parent, root) || strncmp(parent, [root '/'], length(root)+1))
    error('demo_lab:blockedSystem', 'External renderer output is outside attempt: %s', value);
end
end
