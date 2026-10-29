function uistackPMTK(handles, direction)
if exist('uistack', 'file') == 2 || exist('uistack', 'builtin') == 5
    uistack(handles, direction);
    return;
end
handles = handles(:);
if isempty(handles) || ~all(ishghandle(handles)) || numel(unique(handles)) ~= numel(handles)
    error('PMTK:InvalidStackHandles', 'Expected distinct valid graphics handles.');
end
if ~ischar(direction) || ~any(strcmpi(direction, {'top', 'bottom'}))
    error('PMTK:UnsupportedStackDirection', 'The portable stack helper supports top and bottom only.');
end
parent = get(handles(1), 'parent');
for k = 1:numel(handles)
    if ~isequal(get(handles(k), 'parent'), parent)
        error('PMTK:StackParentMismatch', 'Stacked graphics objects must have the same parent.');
    end
end
children = get(parent, 'children');
selected = ismember(children, handles);
if sum(selected) ~= numel(handles)
    error('PMTK:InvalidStackHandles', 'Every graphics handle must occur in the visible parent child list.');
end
if strcmpi(direction, 'top')
    ordered = [children(selected); children(~selected)];
else
    ordered = [children(~selected); children(selected)];
end
set(parent, 'children', ordered);
end
