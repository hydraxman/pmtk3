function varargout = svmLiblinearBackend(action, varargin)
% Genuine LIBLINEAR dispatch with unique Octave MEX names, never train/predict.
% MATLAB retains the original libLinearTrain/libLinearPredict route.
provider = liblinear_provider();
if strcmpi(action, 'info')
    varargout{1} = provider.info;
    return;
end
if ~provider.info.available
    error('PMTK:MissingLiblinearBackend', '%s', provider.info.requirement);
end
switch lower(action)
    case 'train'
        if numel(varargin) ~= 3
            error('PMTK:LiblinearArguments', 'Training requires labels, sparse features and option text.');
        end
        validate_inputs(varargin{1}, varargin{2}, varargin{3});
        classes = max(2,numel(unique(varargin{1})));
        if (double(size(varargin{2},2))+1)*classes > double(intmax('int32'))-2
            error('PMTK:LiblinearSize', 'Native model weight storage exceeds LIBLINEAR signed-int indexing bounds.');
        end
        model = provider.train(varargin{:});
        if isempty(model)
            error('PMTK:LiblinearNativeFailure', 'Native LIBLINEAR did not return a model/result; inspect its diagnostic.');
        end
        varargout{1} = model;
    case 'predict'
        if numel(varargin) ~= 4
            error('PMTK:LiblinearArguments', 'Prediction requires labels, sparse features, native model and option text.');
        end
        validate_inputs(varargin{1}, varargin{2}, varargin{4});
        % Upstream's native binding intentionally rejects exactly two outputs.
        [labels, accuracy, decisions] = provider.predict(varargin{:});
        if numel(labels) ~= size(varargin{2},1) || isempty(decisions) || ...
                ~isreal(labels) || ~isreal(decisions) || ...
                any(~isfinite(labels(:))) || any(~isfinite(decisions(:)))
            error('PMTK:LiblinearNativeFailure', 'Native LIBLINEAR returned empty, nonfinite or invalid predictions.');
        end
        outputs = {labels, accuracy, decisions};
        for k = 1:nargout, varargout{k} = outputs{k}; end
    otherwise
        error('PMTK:LiblinearAction', 'Unknown LIBLINEAR operation: %s', action);
end
end

function validate_inputs(labels, features, options)
if ~isa(features,'double') || ~isreal(features) || ~ismatrix(features) || ~issparse(features) || ...
        any(~isfinite(nonzeros(features))) || ~isa(labels,'double') || ~isreal(labels) || ...
        issparse(labels) || size(labels,2) ~= 1 || numel(labels) ~= size(features,1) || ...
        any(~isfinite(labels(:)))
    error('PMTK:LiblinearInput', 'LIBLINEAR requires finite real double labels and a sparse double feature matrix.');
end
% The actual library uses signed int feature/sample indices, not MEX
% dimension pointers. Bound those scalar conversions independently.
limit = double(intmax('int32'))-2;
if any(size(features) > limit) || nzmax(features) > limit || any(abs(labels(:)) > limit)
    error('PMTK:LiblinearSize', 'Inputs exceed LIBLINEAR signed-int index/label bounds.');
end
if ~ischar(options) || (size(options,1) ~= 1 && ~isempty(options)) || numel(options) >= 1024 || ...
        any(options == char(0)) || any(double(options) > 127)
    error('PMTK:LiblinearOptions', 'Options must be a short ASCII row string (native parser has a fixed buffer).');
end
end

function provider = liblinear_provider()
persistent octave_provider;
if ~exist('OCTAVE_VERSION','builtin')
    available = exist('libLinearTrain','file') ~= 0 && exist('libLinearPredict','file') ~= 0;
    info = struct('name','matlab-legacy-liblinear','available',available, ...
        'train',which('libLinearTrain'),'predict',which('libLinearPredict'), ...
        'requirement','MATLAB requires the original LIBLINEAR libLinearTrain/libLinearPredict provider.');
    provider = struct('info',info);
    if available
        provider.train = @libLinearTrain;
        provider.predict = @libLinearPredict;
    end
    return;
end
if ~isempty(octave_provider)
    provider = octave_provider;
    return;
end
repo = fileparts(fileparts(fileparts(fileparts(mfilename('fullpath')))));
folder = fullfile(repo,'pmtksupportCopy','packages','nativeProviders','liblinear');
names = {'pmtk_liblinear_train','pmtk_liblinear_predict'};
info = struct('name','octave-official-liblinear','available',false,'train','','predict','', ...
    'revision','491c9f1188b97ba70847c70a68be363d186ddf9d', ...
    'requirement','Build and explicitly activate pinned LIBLINEAR with data-tools/build_native_providers.py; no substitute solver is selected.');
provider = struct('info',info);
manifest = fullfile(folder,'provider.json');
if ~exist(manifest,'file'), return; end
document = jsondecode(fileread(manifest));
if ~strcmp(document.family,'liblinear') || ~strcmp(document.source.revision,info.revision) || ...
        ~any(strcmp(document.status,{'built_not_loaded','runtime_verified'}))
    error('PMTK:LiblinearProvenance', 'Active LIBLINEAR manifest does not describe the reviewed build.');
end
if ~strcmp(OCTAVE_VERSION,'11.3.0')
    error('PMTK:LiblinearAbi', 'This native build targets the verified Octave 11.3.0 ABI.');
end
for k = 1:numel(names)
    expected = fullfile(folder,[names{k} '.' mexext]);
    if ~exist(expected,'file'), return; end
    matching = false;
    for j = 1:numel(document.binaries)
        [~,stem,extension] = fileparts(document.binaries(j).file);
        if strcmp([stem extension],[names{k} '.' mexext])
            fid = fopen(expected,'rb');
            if fid < 0, error('PMTK:LiblinearProvenance','Cannot read native provider.'); end
            bytes = fread(fid,Inf,'*uint8')';
            fclose(fid);
            matching = strcmp(hash('sha256',char(bytes)),document.binaries(j).sha256);
        end
    end
    if ~matching
        error('PMTK:LiblinearProvenance', 'Native LIBLINEAR binary does not match its build manifest: %s',expected);
    end
end
% This directory contains only uniquely named MEX files, licenses and JSON.
% Never add the upstream matlab/ directory or generic train/predict symbols.
addpath(folder,'-begin');
for k = 1:numel(names)
    expected = fullfile(folder,[names{k} '.' mexext]);
    actual = which(names{k});
    if exist(names{k},'file') ~= 3 || ~strcmpi(actual,expected)
        error('PMTK:LiblinearOrigin', 'Unexpected native LIBLINEAR origin: %s',actual);
    end
    provider.info.(names_to_field(k)) = actual;
end
provider.info.available = true;
provider.train = str2func(names{1});
provider.predict = str2func(names{2});
octave_provider = provider;
end

function name = names_to_field(k)
if k == 1, name = 'train'; else, name = 'predict'; end
end
