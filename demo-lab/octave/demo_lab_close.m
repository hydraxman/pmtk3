function demo_lab_close(handle)
% Deliberately do not call close() from a close callback.
mlock;
demo_lab_capture(handle, 'close');
if ishghandle(handle)
    delete(handle);
end
end
