function varargout = svmLibsvmBackend(action, varargin)
% One dispatch point for genuine LIBSVM APIs, never MATLAB Statistics SVM.
% Octave requires the installed statistics package to be loaded. MATLAB keeps
% PMTK's legacy libsvmTrain / svmLibMexPredict (or libsvmPredict) provider.
provider = svm_libsvm_provider();
if strcmpi(action, 'info')
    varargout{1} = provider.info;
    return;
end
if ~provider.info.available
    error('PMTK:MissingLibsvmBackend', '%s', provider.info.requirement);
end
switch lower(action)
    case 'train'
        % LIBSVM cross-validation options intentionally return a scalar.
        varargout{1} = provider.train(varargin{:});
    case 'predict'
        % Octave's native wrapper requires all THREE outputs, even if the
        % public caller needs only labels. Preserve accuracy/decision/prob API.
        inputs = varargin;
        singleton = strcmp(provider.info.name, 'octave-statistics-libsvm') && ...
            size(inputs{2}, 1) == 1 && numel(inputs{1}) == 1;
        if singleton
            % statistics 1.8.3's compiled wrapper returns zero-filled outputs
            % for a single test row. Predictions are row-independent: submit
            % two IDENTICAL rows to the same native backend, then retain one.
            % No alternate algorithm, fabricated margin, or exception fallback.
            inputs{1} = [inputs{1}(:); inputs{1}(:)];
            inputs{2} = [inputs{2}; inputs{2}];
        end
        [labels, accuracy, values] = provider.predict(inputs{:});
        if singleton
            labels = labels(1, :);
            values = values(1, :);
        end
        outputs = {labels, accuracy, values};
        for k = 1:nargout, varargout{k} = outputs{k}; end
    otherwise
        error('PMTK:LibsvmAction', 'Unknown LIBSVM operation: %s', action);
end
end

function provider = svm_libsvm_provider()
persistent octave_provider;
if exist('OCTAVE_VERSION', 'builtin')
    if ~isempty(octave_provider)
        provider = octave_provider;
        return;
    end
    train_file = which('svmtrain');
    predict_file = which('svmpredict');
    roots = {};
    packages = pkg('list');
    for k = 1:numel(packages)
        if strcmp(packages{k}.name, 'statistics')
            for field = {'dir', 'archprefix'}
                if isfield(packages{k}, field{1})
                    roots{end+1} = packages{k}.(field{1});
                end
            end
        end
    end
    available = exist('svmtrain', 'file') == 3 && exist('svmpredict', 'file') == 3 && ...
        svm_native_origin(train_file, roots) && svm_native_origin(predict_file, roots);
    info = struct('name', 'octave-statistics-libsvm', 'available', available, ...
        'train', train_file, 'predict', predict_file, ...
        'requirement', 'Load Octave statistics with its native svmtrain.oct/svmpredict.oct ahead of legacy support; preserve PMTK normalize precedence.');
    provider = struct('info', info);
    if available
        provider.train = @svmtrain;
        provider.predict = @svmpredict;
        octave_provider = provider; % CV reuses bound genuine native functions
    end
else
    train_name = 'libsvmTrain';
    predict_name = 'svmLibMexPredict';
    if ~exist(predict_name, 'file') && exist('libsvmPredict', 'file')
        predict_name = 'libsvmPredict';
    end
    available = exist(train_name, 'file') ~= 0 && exist(predict_name, 'file') ~= 0;
    info = struct('name', 'matlab-legacy-libsvm', 'available', available, ...
        'train', which(train_name), 'predict', which(predict_name), ...
        'requirement', 'MATLAB requires the legacy LIBSVM provider, not MATLAB Statistics svmtrain.');
    provider = struct('info', info);
    if available
        provider.train = str2func(train_name);
        provider.predict = str2func(predict_name);
    end
end
end

function answer = svm_native_origin(filename, roots)
answer = false;
filename = strrep(canonicalize_file_name(filename), '\', '/');
if ispc(), filename = lower(filename); end
[~, ~, extension] = fileparts(filename);
if ~strcmpi(extension, '.oct'), return; end
for k = 1:numel(roots)
    root = strrep(canonicalize_file_name(roots{k}), '\', '/');
    if ispc(), root = lower(root); end
    answer = answer || (~isempty(root) && strncmp(filename, [root '/'], length(root)+1));
end
end
