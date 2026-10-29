function demo_lab_invoke()
% An independent workspace protects the main protocol from clear / clear all.
% source(), unlike run(), does not temporarily cd into the original demos dir.
if strcmp(getenv('DEMO_LAB_ENTRY_TYPE'), 'function')
    feval(getenv('DEMO_LAB_ENTRY'));
else
    source(getenv('DEMO_LAB_SOURCE'));
end
end
