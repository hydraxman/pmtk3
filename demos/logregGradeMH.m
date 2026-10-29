function [X, y, bs, perm] = logregGradeMH();
% Example from Johnson and Albert p87

%logregGradeData() % X,y,N

[X, y] = satDataLoad();
N = size(X,1);


loss = @(w) LogisticLossSimple(w, X, 2*y-1);
options = optimset('GradObj', 'on', 'Display', 'off', ...
    'TolFun', 1e-10, 'TolX', 1e-10, 'MaxIter', 2000, 'MaxFunEvals', 10000);
[beta, ~, exitflag] = fminunc(loss, zeros(size(X,2),1), options);
if exitflag <= 0
    error('PMTK:LogregMLEConvergence', 'The fminunc logistic MLE did not converge.');
end
[~, ~, information] = loss(beta);
C = information \ eye(size(information))
betaFminunc = beta;
sqrt(diag(C))

% Newton steps on logistic likelihood are the canonical IRLS updates.
fitOptions = struct('Method', 'newton', 'Display', 'off', ...
    'optTol', 1e-8, 'progTol', 1e-12, 'MaxIter', 1000);
fitted = logregFit(X, y, 'lambda', 0, 'preproc', preprocessorCreate(), ...
    'fitOptions', fitOptions);
beta = fitted.w;
[~, ~, information] = loss(beta);
assert(norm(X*(beta-betaFminunc), inf) < 1e-4, 'Logistic MLE optimizers disagree.');
C = information \ eye(size(information))
sqrt(diag(C))

% MH
seed = 1; randn('state', seed); rand('state', seed);
xinit = beta;
Nsamples = 5000;
sigmaMH = 1.5;
target = @(b) -LogisticLossSimple(b(:), X, 2*y-1);
proposal = @(b) b + mvnrnd(zeros(1, numel(b)), sigmaMH*C);
[bs, naccept] = metropolisHastings(target, proposal, xinit, Nsamples);

% trace plots
figure(1); clf
for i=1:2
  subplot(2,2,i)
  plot(bs(:,i))
end

% samples
figure(2);clf
subplot(2,2,1)
hist(bs(:,2))
title('b1 slope')
subplot(2,2,2)
plot(bs(:,1), bs(:,2), '.')
xlabel('b0'); ylabel('b1')
subplot(2,2,4)
hist(bs(:,1))
title('b0 intercept')

MLE =  xinit
postMean  = mean(bs,1)
postMedian = median(bs,1)
  
% visualize model fit for each training point
figure(3);clf
[junk,perm] = sort(X(:,2),'ascend');
N = length(perm);
for ii=1:N
  i = perm(ii);
  ps = 1 ./ (1+exp(-X(i,:)*bs')); % ps(s) = p(y=1|x(i,:), bs(s,:)) row vec

  plot(X(i,2), median(ps), 'o');
  hold on
  h=plot(X(i,2), y(i), 'ko');
  set(h,'markerfacecolor', 'k');
  
  % prediction interval
  tmp = sort(ps, 'ascend');
  Q5 = tmp(floor(0.05*Nsamples));
  Q95 = tmp(floor(0.95*Nsamples));
  line([X(i,2) X(i,2)], [Q5 Q95]);
end


end
