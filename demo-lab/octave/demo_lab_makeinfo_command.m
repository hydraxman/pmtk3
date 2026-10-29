function command = demo_lab_makeinfo_command(tokens)
% Permit only Octave's own help formatter, pinned to the provisioned runtime.
% No PATH lookup, arbitrary executable, includes, output files, or shell syntax.
engine = canonicalize_file_name(getenv('DEMO_LAB_OCTAVE'));
if isempty(engine), error('demo_lab:blockedSystem', 'Cannot pin makeinfo to the owned runtime'); end
bin = fileparts(engine);
formatter = '';
if ispc(), suffixes = {'.bat', '.exe', ''}; else, suffixes = {'', '.exe'}; end
candidates = {};
for k = 1:numel(suffixes)
    candidate = canonicalize_file_name(fullfile(bin, ['makeinfo' suffixes{k}]));
    if ~isempty(candidate)
        candidates{end+1} = candidate;
        if isempty(formatter), formatter = candidate; end
    end
end
if isempty(formatter), error('demo_lab:blockedSystem', 'Bundled makeinfo is unavailable'); end
[folder, ~, ~] = fileparts(tokens{1});
if ~isempty(folder)
    supplied = canonicalize_file_name(tokens{1});
    if ispc(), supplied = lower(supplied); candidates = cellfun(@lower, candidates, 'UniformOutput', false); end
    if ~any(strcmp(candidates, supplied))
        error('demo_lab:blockedSystem', 'makeinfo executable is not in the owned runtime');
    end
end
stack = dbstack();
core = strrep(canonicalize_file_name(fullfile(bin, '..', 'share', 'octave')), '\', '/');
if ispc(), core = lower(core); end
core_formatter = false;
for k = 1:numel(stack)
    filename = strrep(canonicalize_file_name(stack(k).file), '\', '/');
    if ispc(), filename = lower(filename); end
    core_formatter = core_formatter || (strcmp(stack(k).name, '__makeinfo__') && ...
        ~isempty(core) && strncmp(filename, [core '/'], length(core)+1));
end
if ~core_formatter
    error('demo_lab:blockedSystem', 'makeinfo formatting is allowed only from the core Octave formatter');
end
if numel(tokens) < 3 || ~any(strcmp(tokens, '--output=-')) || ...
        ~(any(strcmp(tokens, '--plaintext')) || any(strcmp(tokens, '--html')))
    error('demo_lab:blockedSystem', 'Only makeinfo stdout formatting is permitted');
end
allowed = {'--no-headers', '--no-warn', '--no-validate', '--plaintext', '--html', ...
           '--fill-column=80', '--output=-', '--force'};
k = 2;
while k < numel(tokens)
    if strcmp(tokens{k}, '-c') && k+1 < numel(tokens) && strcmp(tokens{k+1}, 'exampleindent=2')
        k = k + 2;
        continue;
    end
    if ~any(strcmp(tokens{k}, allowed))
        error('demo_lab:blockedSystem', 'Unreviewed makeinfo argument: %s', tokens{k});
    end
    k = k + 1;
end
input = canonicalize_file_name(tokens{end});
tmp = canonicalize_file_name(fullfile(getenv('DEMO_LAB_ATTEMPT'), 'tmp'));
[parent, basename, ~] = fileparts(input);
if ispc(), parent = lower(parent); tmp = lower(tmp); end
if isempty(input) || isempty(tmp) || ~strcmp(parent, tmp) || ~strncmp(basename, 'octave-help-', 12)
    error('demo_lab:blockedSystem', 'makeinfo input is not an attempt-local Octave help temporary');
end
command = ['"' formatter '" ' strjoin(tokens(2:end-1), ' ') ' "' input '"'];
end
