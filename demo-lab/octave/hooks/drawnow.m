function drawnow(varargin)
% Opportunistic partial PNGs for animations/loops which may later time out.
% Cannot interrupt a computation which never pumps graphics; no false promise
% of recovering figures from an already killed process.
builtin('drawnow', varargin{:});
if isappdata(0, 'demo_lab_capture_busy') && getappdata(0, 'demo_lab_capture_busy')
    return;
end
if isappdata(0, 'demo_lab_original_render_busy') && getappdata(0, 'demo_lab_original_render_busy')
    return;
end
last = getappdata(0, 'demo_lab_last_snapshot');
if isempty(last), last = 0; end
if time() - last < 5, return; end
setappdata(0, 'demo_lab_last_snapshot', time());
handle = get(0, 'currentfigure');
if ~isempty(handle) && ishghandle(handle)
    demo_lab_capture(handle, 'drawnow-snapshot');
end
end
