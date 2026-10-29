function varargout = print(varargin)
% Capture before the ORIGINAL print, so even a failed legacy export keeps PNGs.
% The original function handle was bound before this hook was put on the path.
original = getappdata(0, 'demo_lab_original_print');
handle = get(0, 'currentfigure');
if ~isempty(varargin) && isnumeric(varargin{1}) && isscalar(varargin{1}) && ishghandle(varargin{1})
    handle = varargin{1};
end
if ~isempty(handle), demo_lab_capture(handle, 'print'); end
if ~isempty(handle), demo_lab_prepare_export(handle); end
% Original output must stay under the disposable working directory. Do not
% silently redirect arbitrary absolute filenames or swallow original errors.
for k = 1:numel(varargin)
    value = varargin{k};
    if ~ischar(value) || isempty(value) || value(1) == '-', continue; end
    candidate = make_absolute_filename(value);
    parent = canonicalize_file_name(fileparts(candidate));
    work = canonicalize_file_name(fullfile(getenv('DEMO_LAB_ATTEMPT'), 'work'));
    parent = strrep(parent, '\', '/');
    work = strrep(work, '\', '/');
    if ispc(), parent = lower(parent); work = lower(work); end
    if isempty(parent) || ~(strcmp(parent, work) || strncmp(parent, [work '/'], length(work)+1))
        error('demo_lab:unsafePrintPath', 'Original print output is outside the attempt work directory: %s', value);
    end
end
% Octave's own validated exporter may invoke Ghostscript/font/render tools.
% Scope this permission to the original print stack, not arbitrary source OS calls.
prior = false;
if isappdata(0, 'demo_lab_original_render_busy')
    prior = getappdata(0, 'demo_lab_original_render_busy');
end
setappdata(0, 'demo_lab_original_render_busy', true);
cleanup = onCleanup(@() setappdata(0, 'demo_lab_original_render_busy', prior));
[varargout{1:nargout}] = original(varargin{:});
end
