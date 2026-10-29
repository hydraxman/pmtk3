function report = demo_lab_check_origins(plan, attempt)
% Verify both provenance and small semantic invariants of real PMTK helpers.
% These are environment checks, not substitutes for original demo execution.
report = struct('policy', 'pmtk-semantic-origins-v1', 'status', 'checking', 'checks', {{}});
mismatches = {};
for k = 1:numel(plan.critical_origins)
    contract = plan.critical_origins(k);
    actual = which(contract.name);
    expected = contract.expected;
    if isempty(expected), expected = ''; end
    ok = isempty(contract.resolution_error) && demo_lab_same_file(expected, actual);
    check = struct('name', contract.name, 'expected', expected, 'actual', actual, ...
                   'ok', ok, 'resolution_error', contract.resolution_error);
    report.checks{end+1} = check;
    fprintf('DEMO-LAB origin %s: %s\n', contract.name, actual);
    if ~ok
        mismatches{end+1} = sprintf('%s expected [%s], actual [%s]: %s', ...
            contract.name, expected, actual, contract.resolution_error);
    end
end
if ~isempty(mismatches)
    report.status = 'origin_mismatch';
    report.errors = mismatches;
    demo_lab_write_contract_report(attempt, report);
    error('demo_lab:pathOrigin', 'Critical numerical origin mismatch: %s', strjoin(mismatches, '; '));
end
try
    % A 3-D factor must have ONE global partition constant by default.
    [probability, partition] = normalize(reshape(1:8, [2 2 2]));
    if ~isscalar(partition) || abs(partition-36) > 1e-12 || abs(sum(probability(:))-1) > 1e-12
        error('demo_lab:semanticContract', 'normalize default must normalize the WHOLE array with scalar Z=36');
    end
    weights = normalize([1 1]);
    if ~isequal(size(weights), [1 2]) || any(abs(weights-[.5 .5]) > 1e-12)
        error('demo_lab:semanticContract', 'normalize([1 1]) must produce mixture weights [.5 .5]');
    end
    [columns, column_partition] = normalize([1 3; 2 4], 1);
    if any(abs(sum(columns, 1)-1) > 1e-12) || any(abs(column_partition-[3 7]) > 1e-12)
        error('demo_lab:semanticContract', 'normalize explicit dimension contract failed');
    end
    % Exercise the REAL factor wrapper too: alarm/junction-tree code assigns
    % this partition into a scalar slot, not a 1-by-3-by-3 column statistic.
    factor = tabularFactorCreate(reshape(1:27, [3 3 3]), 1:3);
    [factor, factor_partition] = tabularFactorNormalize(factor);
    if ~isscalar(factor_partition) || abs(factor_partition-378) > 1e-12 || ...
            ~isequal(size(factor.T), [3 3 3]) || abs(sum(factor.T(:))-1) > 1e-12
        error('demo_lab:semanticContract', 'tabularFactorNormalize must preserve 3x3x3 shape with scalar Z=378 and unit total mass');
    end
    % Lightspeed logsumexp uses dim=1 even for a row vector.
    row_default = logsumexp([0 log(2)]);
    row_total = logsumexp([0 log(2)], 2);
    stable_total = logsumexp([-1000 -1000], 2);
    if ~isequal(size(row_default), [1 2]) || any(abs(row_default-[0 log(2)]) > 1e-12) || ...
            abs(row_total-log(3)) > 1e-12 || abs(stable_total-(-1000+log(2))) > 1e-10
        error('demo_lab:semanticContract', 'logsumexp dimension/stability contract failed');
    end
    [first, second] = process_options(struct('second', 7), 'first', 3, 'second', 0);
    if first ~= 3 || second ~= 7
        error('demo_lab:semanticContract', 'PMTK process_options structured arguments contract failed');
    end
    gaussian = gaussLogprob(0, 4, [0; 2]); % second input is variance, not std
    expected = [-.5*log(8*pi); -.5*log(8*pi)-.5];
    if ~isequal(size(gaussian), [2 1]) || any(abs(gaussian-expected) > 1e-12)
        error('demo_lab:semanticContract', 'gaussLogprob variance/shape contract failed');
    end
    report.semantic_checks = struct('whole_array_partition', partition, ...
        'whole_array_probability_sum', sum(probability(:)), 'mixture_weights', weights, ...
        'tabular_factor_origin', which('tabularFactorNormalize'), ...
        'tabular_factor_partition', factor_partition, ...
        'tabular_factor_probability_sum', sum(factor.T(:)), 'tabular_factor_shape', size(factor.T), ...
        'column_partition', column_partition, 'logsumexp_row_default', row_default, ...
        'logsumexp_row_total', row_total, 'logsumexp_stable_total', stable_total, ...
        'process_options', [first second], 'gaussLogprob', gaussian);
    report.status = 'passed';
catch err
    report.status = 'semantic_mismatch';
    report.error = struct('identifier', err.identifier, 'message', err.message, 'stack', err.stack);
    demo_lab_write_contract_report(attempt, report);
    rethrow(err);
end
demo_lab_write_contract_report(attempt, report);
end

function answer = demo_lab_same_file(expected, actual)
expected = canonicalize_file_name(expected);
actual = canonicalize_file_name(actual);
if ispc(), expected = lower(expected); actual = lower(actual); end
answer = ~isempty(expected) && strcmp(strrep(expected, '\', '/'), strrep(actual, '\', '/'));
end

function demo_lab_write_contract_report(attempt, report)
filename = fullfile(attempt, 'path-origins.json');
fid = fopen([filename '.tmp'], 'w');
if fid < 0, error('demo_lab:pathReport', 'Cannot write numerical-origin report'); end
fprintf(fid, '%s\n', jsonencode(report));
fclose(fid);
[status, message] = rename([filename '.tmp'], filename);
if status ~= 0, error('demo_lab:pathReport', '%s', message); end
end
