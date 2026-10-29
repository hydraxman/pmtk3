function demo_lab_prepare_export(handle)
% Do not coerce modern scatter graphics into gnuplot's older object model.
% Retaining the supported native renderer preserves original data/objects.
selected = getappdata(0, 'demo_lab_toolkit');
actual = get(handle, '__graphics_toolkit__');
if ~isempty(findall(handle, 'type', 'scatter'))
    available = available_graphics_toolkits();
    if strcmp(actual, 'qt') || (strcmp(actual, 'fltk') && strcmp(get(handle, 'visible'), 'on'))
        fprintf('DEMO-LAB modern scatter: retaining native %s renderer\n', actual);
        return;
    end
    % FLTK cannot print invisible figures in this Octave build. Do not silently
    % enable windows or damage original scatter objects by forcing gnuplot.
    for candidate = {'qt'}
        if any(strcmp(available, candidate{1}))
            fprintf('DEMO-LAB modern scatter: selecting supported %s renderer\n', candidate{1});
            graphics_toolkit(handle, candidate{1});
            return;
        end
    end
    error('demo_lab:headlessScatter', 'Modern scatter requires Qt for invisible export; installed FLTK requires visible figures. Source objects preserved; no gnuplot coercion attempted.');
end
if ~isempty(selected) && ~strcmp(actual, selected)
    fprintf('DEMO-LAB capture toolkit: %s -> declared %s\n', actual, selected);
    graphics_toolkit(handle, selected);
end
end
