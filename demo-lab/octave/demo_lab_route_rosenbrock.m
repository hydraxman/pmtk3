function report = demo_lab_route_rosenbrock(repo, shims)
% Route ONE existing upstream symbol, without promoting its Foreign directory.
% No numerical implementation is supplied here; the upstream bytes are copied.
source = fullfile(repo, 'pmtksupportCopy', 'packages', 'markSchmidt-9march2011', ...
    'markSchmidt', 'Foreign', 'rosenbrock.m');
report = struct('available', false, 'status', 'canonical_source_absent', ...
    'expected_source', source, 'source', '', 'source_sha256', '', ...
    'shim', '', 'shim_sha256', '', 'resolved', which('rosenbrock'), ...
    'previous_origin', which('rosenbrock'), 'minimize_before', which('minimize'), ...
    'minimize_after', which('minimize'));
if exist(source, 'file') ~= 2
    % Optional routing: canonical-absent probes retain their existing provider.
    return;
end
report.available = true;
report.source = canonicalize_file_name(source);
target = fullfile(shims, 'rosenbrock.m');
fid = fopen(source, 'rb');
if fid < 0, error('demo_lab:rosenbrockCopy', 'Cannot read canonical rosenbrock'); end
bytes = fread(fid, Inf, '*uint8');
fclose(fid);
report.source_sha256 = builtin('hash', 'sha256', char(bytes(:)'));
fid = fopen([target '.copying'], 'wb');
if fid < 0, error('demo_lab:rosenbrockCopy', 'Cannot create confined rosenbrock shim'); end
count = fwrite(fid, bytes, 'uint8');
fclose(fid);
if count ~= numel(bytes), error('demo_lab:rosenbrockCopy', 'Incomplete rosenbrock copy'); end
[status, message] = rename([target '.copying'], target);
if status ~= 0, error('demo_lab:rosenbrockCopy', '%s', message); end
fid = fopen(target, 'rb');
if fid < 0, error('demo_lab:rosenbrockCopy', 'Cannot verify rosenbrock shim'); end
copied = fread(fid, Inf, '*uint8');
fclose(fid);
report.shim = canonicalize_file_name(target);
report.shim_sha256 = builtin('hash', 'sha256', char(copied(:)'));
if ~isequal(bytes, copied) || ~strcmp(report.source_sha256, report.shim_sha256)
    error('demo_lab:rosenbrockCopy', 'Rosenbrock shim is not byte-identical to canonical source');
end
% The attempt shims directory is ALREADY first; only refresh this new symbol.
rehash();
clear rosenbrock;
report.resolved = which('rosenbrock');
report.minimize_after = which('minimize');
actual = canonicalize_file_name(report.resolved);
expected = report.shim;
if ispc(), actual = lower(actual); expected = lower(expected); end
if ~strcmp(strrep(actual, '\', '/'), strrep(expected, '\', '/'))
    error('demo_lab:rosenbrockOrigin', 'Expected confined shim %s, resolved %s', report.shim, report.resolved);
end
if ~strcmp(report.minimize_before, report.minimize_after)
    error('demo_lab:rosenbrockOrigin', 'Confined routing unexpectedly changed minimize provider');
end
[value, gradient, hessian, third] = rosenbrock(ones(2,1));
expected_hessian = [802 -400; -400 200];
if ~isscalar(value) || abs(value) > 1e-12 || ~isequal(size(gradient), [2 1]) || ...
        norm(gradient) > 1e-12 || ~isequal(size(hessian), [2 2]) || ...
        max(abs(hessian(:)-expected_hessian(:))) > 1e-12 || ...
        ~isequal(size(third), [2 2 2]) || ~all(isfinite(third(:)))
    error('demo_lab:rosenbrockSemantics', 'Canonical four-output Rosenbrock contract failed at ones(2,1)');
end
report.semantic_check = struct('passed', true, 'point', [1;1], 'value', value, ...
    'gradient', gradient, 'hessian', hessian, 'third_derivative_size', size(third), ...
    'third_derivative_finite', all(isfinite(third(:))));
report.status = 'routed_byte_identical';
fprintf('DEMO-LAB confined rosenbrock: %s (source %s, sha256 %s)\n', ...
    report.resolved, report.source, report.source_sha256);
end
