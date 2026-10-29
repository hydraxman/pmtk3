function setHeightColorsPMTK(handles)
handles = handles(:);
if isempty(handles) || ~all(ishghandle(handles))
    error('PMTK:InvalidColorHandles', 'Expected surface or patch graphics handles.');
end
for k = 1:numel(handles)
    h = handles(k);
    if isprop(h, 'CDataMode')
        set(h, 'FaceColor', 'interp', 'CDataMode', 'auto');
    elseif strcmp(get(h, 'type'), 'surface')
        set(h, 'CData', get(h, 'ZData'), 'FaceColor', 'interp');
    elseif strcmp(get(h, 'type'), 'patch')
        vertices = get(h, 'Vertices');
        set(h, 'FaceVertexCData', vertices(:,3), 'FaceColor', 'interp');
    else
        error('PMTK:UnsupportedColorObject', 'Height colors require surface or patch objects.');
    end
end
end
