function demo_lab_fixtures()
% Six tiny independent analytic contracts; not original PMTK demos.
attempt = getenv('DEMO_LAB_ATTEMPT');
inputs = jsondecode(fileread(fullfile(attempt, 'fixture-inputs.json')));
result = struct();

p = inputs.beta_posterior;
a = p.prior(1) + p.successes; b = p.prior(2) + p.failures;
grid = p.grid(:)';
density = exp(gammaln(a+b)-gammaln(a)-gammaln(b)+(a-1)*log(grid)+(b-1)*log(1-grid));
result.beta_posterior = struct('posterior', [a b], 'mean', a/(a+b), ...
    'variance', a*b/((a+b)^2*(a+b+1)), 'density', density);

p = inputs.ols_ridge;
X = p.x; y = p.y(:);
w = X \ y;
penalty = diag([0 p.lambda]);
ridge = (X'*X + penalty) \ (X'*y);
result.ols_ridge = struct('ols', w', 'ridge', ridge', ...
    'ols_predictions', (X*w)', 'ridge_predictions', (X*ridge)');

p = inputs.pca2d;
mu = mean(p.x, 1);
centered = bsxfun(@minus, p.x, mu);
C = (centered'*centered)/(rows(p.x)-1);
[V, D] = eig(C);
[eigenvalues, order] = sort(diag(D), 'descend');
v = V(:, order(1));
result.pca2d = struct('mean', mu, 'covariance', C, 'eigenvalues', eigenvalues', ...
    'principal_projector', v*v');

p = inputs.mixture_em;
x = p.x(:); means = p.means(:)'; variances = p.variances(:)'; weights = p.weights(:)';
history = zeros(1, p.iterations);
for iteration = 1:p.iterations
    [resp, ignored] = expectation(x, means, variances, weights);
    mass = sum(resp, 1);
    means = sum(bsxfun(@times, resp, x), 1)./mass;
    deviation = bsxfun(@minus, x, means);
    variances = max(p.variance_floor, sum(resp.*(deviation.^2), 1)./mass);
    weights = mass/numel(x);
    [ignored, history(iteration)] = expectation(x, means, variances, weights);
end
[resp, ignored] = expectation(x, means, variances, weights);
assert(all(abs(sum(resp, 2)-1) < 1e-10));
result.mixture_em = struct('means', means, 'variances', variances, 'weights', weights, ...
    'responsibilities', resp, 'log_likelihood_history', history);

p = inputs.hmm_forward_backward;
observations = p.observations(:)' + 1; % JSON observations are zero-based.
T = numel(observations);
alpha = zeros(T, 2); beta = ones(T, 2); scales = zeros(1, T);
for t = 1:T
    if t == 1, prediction = p.initial(:)'; else, prediction = alpha(t-1,:)*p.transition; end
    values = prediction.*p.emission(:, observations(t))';
    scales(t) = sum(values);
    alpha(t,:) = values/scales(t);
end
for t = T-1:-1:1
    beta(t,:) = (p.transition*(p.emission(:, observations(t+1)).*beta(t+1,:)'))'/scales(t+1);
end
posterior = alpha.*beta;
posterior = bsxfun(@rdivide, posterior, sum(posterior, 2));
assert(all(abs(sum(posterior, 2)-1) < 1e-10));
result.hmm_forward_backward = struct('alpha', alpha, 'beta', beta, ...
    'posterior', posterior, 'log_evidence', sum(log(scales)));

p = inputs.sprinkler;
joint = zeros(1, 16); index = 0; wet = 0; rain_wet = 0;
for cloudy = 0:1
    for spray = 0:1
        for rain = 0:1
            pc = p.cloudy; if ~cloudy, pc = 1-pc; end
            ps = p.sprinkler_given_cloudy(cloudy+1); if ~spray, ps = 1-ps; end
            pr = p.rain_given_cloudy(cloudy+1); if ~rain, pr = 1-pr; end
            pw = p.wet_given_sprinkler_rain(spray+1, rain+1);
            for water = 0:1
                probability = pc*ps*pr;
                if water, probability = probability*pw; else, probability = probability*(1-pw); end
                index = index + 1; joint(index) = probability;
                if water
                    wet = wet + probability;
                    if rain, rain_wet = rain_wet + probability; end
                end
            end
        end
    end
end
assert(abs(sum(joint)-1) < 1e-10);
result.sprinkler = struct('joint', joint, 'normalization', sum(joint), ...
    'wet_probability', wet, 'rain_given_wet', rain_wet/wet);
filename = fullfile(attempt, 'analytics-output.json');
fid = fopen(filename, 'w');
if fid < 0, error('demo_lab:fixture', 'Cannot write fixture JSON'); end
fprintf(fid, '%s\n', jsonencode(result));
fclose(fid);
end

function [resp, loglik] = expectation(x, means, variances, weights)
deviation = bsxfun(@minus, x, means);
terms = bsxfun(@times, exp(bsxfun(@rdivide, -.5*(deviation.^2), variances)), ...
    weights./sqrt(2*pi*variances));
totals = sum(terms, 2);
resp = bsxfun(@rdivide, terms, totals);
loglik = sum(log(totals));
end
