function demo_lab_capture(handle, reason)
% Save a new PNG to the attempt, never to the original figures directory.
mlock;
if ~ishghandle(handle) || (isappdata(0, 'demo_lab_capture_busy') && getappdata(0, 'demo_lab_capture_busy'))
    return;
end
closing = any(strcmp(reason, {'close', 'delete'}));
if closing && isappdata(handle, 'demo_lab_close_captured')
    return;
end
setappdata(0, 'demo_lab_capture_busy', true);
if closing, setappdata(handle, 'demo_lab_close_captured', true); end
filename = '';
try
    demo_lab_prepare_export(handle);
    index = getappdata(0, 'demo_lab_capture_index') + 1;
    setappdata(0, 'demo_lab_capture_index', index);
    reason = regexprep(reason, '[^A-Za-z0-9_-]', '_');
    filename = fullfile(getenv('DEMO_LAB_ATTEMPT'), 'figures', ...
        sprintf('figure-%04d-%s.png', index, reason));
    temporary = [filename '.part.png'];
    drawnow();
    original_print = getappdata(0, 'demo_lab_original_print');
    original_print(handle, temporary, '-dpng', '-r110');
    [status, message] = rename(temporary, filename);
    if status ~= 0, error('demo_lab:capture', '%s', message); end
    fprintf('DEMO-LAB PNG: %s\n', filename);
catch err
    errors = getappdata(0, 'demo_lab_capture_errors');
    errors{end+1} = struct('reason', reason, 'file', filename, 'message', err.message);
    setappdata(0, 'demo_lab_capture_errors', errors);
    fprintf(2, 'DEMO-LAB PNG capture failed (%s): %s\n', reason, err.message);
end
setappdata(0, 'demo_lab_capture_busy', false);
% Durable diagnostics even if the demo subsequently times out.
try
    checkpoint = fullfile(getenv('DEMO_LAB_ATTEMPT'), 'capture-state.json');
    fid = fopen([checkpoint '.tmp'], 'w');
    if fid >= 0
        fprintf(fid, '%s\n', jsonencode(struct('errors', {getappdata(0, 'demo_lab_capture_errors')})));
        fclose(fid);
        rename([checkpoint '.tmp'], checkpoint);
    end
catch err
    fprintf(2, 'DEMO-LAB capture checkpoint failed: %s\n', err.message);
end
end
