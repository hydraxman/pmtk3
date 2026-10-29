function [plan, defaults] = demo_lab_complete_path_plan(plan, repo)
% Backward compatibility with manifests emitted by an already-imported runner.
% The actual original PMTK paths are authoritative, not new Python JSON keys.
defaults = {};
if ~isfield(plan, 'directories') || isempty(plan.directories)
    error('demo_lab:pathPlan', 'Path plan lacks its original directories field');
end
if ~isfield(plan, 'skipped'), plan.skipped = {}; defaults{end+1} = 'skipped'; end
if ~isfield(plan, 'candidate_function_names')
    plan.candidate_function_names = {};
    for k = 1:numel(plan.directories)
        sources = dir(fullfile(plan.directories{k}, '*.m'));
        for j = 1:numel(sources)
            [~, name, ~] = fileparts(sources(j).name);
            if ~isempty(regexp(name, '^[A-Za-z][A-Za-z0-9_]*$', 'once'))
                plan.candidate_function_names{end+1} = name;
            end
        end
    end
    plan.candidate_function_names = unique(plan.candidate_function_names);
    defaults{end+1} = 'candidate_function_names';
end
if ~isfield(plan, 'preferred_directories') || isempty(plan.preferred_directories)
    plan.preferred_directories = {fullfile(repo, 'matlabTools', 'stats'), ...
        fullfile(repo, 'matlabTools', 'util'), fullfile(repo, 'toolbox', 'BasicModels', 'gauss')};
    defaults{end+1} = 'preferred_directories';
end
if ~isfield(plan, 'critical_origins') || isempty(plan.critical_origins) || ...
        ~isstruct(plan.critical_origins) || ...
        ~all(isfield(plan.critical_origins, {'name', 'expected', 'resolution_error'}))
    names = {'normalize', 'process_options', 'gaussLogprob'};
    relative = {fullfile('matlabTools', 'stats', 'normalize.m'), ...
        fullfile('matlabTools', 'util', 'process_options.m'), ...
        fullfile('toolbox', 'BasicModels', 'gauss', 'gaussLogprob.m')};
    contracts = struct('name', {}, 'expected', {}, 'promote', {}, 'resolution_error', {});
    for k = 1:numel(names)
        expected = fullfile(repo, relative{k});
        problem = '';
        if exist(expected, 'file') ~= 2, problem = 'Original PMTK source missing'; end
        contracts(end+1) = struct('name', names{k}, 'expected', expected, ...
            'promote', true, 'resolution_error', problem);
    end
    candidates = {};
    lightspeed = {};
    for k = 1:numel(plan.directories)
        candidate = fullfile(plan.directories{k}, 'logsumexp.m');
        if exist(candidate, 'file') == 2
            candidate = canonicalize_file_name(candidate);
            candidates{end+1} = candidate;
            if ~isempty(strfind(lower(candidate), 'lightspeed'))
                lightspeed{end+1} = candidate;
            end
        end
    end
    candidates = unique(candidates);
    if ~isempty(lightspeed), candidates = unique(lightspeed); end
    expected = ''; problem = 'Missing or ambiguous support logsumexp origin';
    if numel(candidates) == 1, expected = candidates{1}; problem = ''; end
    contracts(end+1) = struct('name', 'logsumexp', 'expected', expected, ...
        'promote', false, 'resolution_error', problem);
    plan.critical_origins = contracts;
    defaults{end+1} = 'critical_origins';
end
end
