function answer = svmInstalled()
% Presence predicate for the actual LIBSVM provider used by svmFit.
info = svmLibsvmBackend('info');
answer = info.available;
end
