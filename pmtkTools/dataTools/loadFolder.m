function folderPath = loadFolder(folder)
%% Ensure a local dataset folder is on the path and return its absolute path.

% This file is from pmtk3.googlecode.com


folderPath = loadData(folder, 'isMatFile', false);
end
