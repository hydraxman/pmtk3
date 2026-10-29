%% Compute pairwise mutual information in autompg dataset

% This file is from pmtk3.googlecode.com


%loadData('adultCensus'); % make sure data is on path
%[data] = adultDataPreprocess;
data = loadData('autompg');

[N,D] = size(data.X);
cndx = (data.types == 'c');
XC = data.X(:, cndx);
XD = data.X(:, ~cndx);
mi = mutualInfoAllPairsMixed(XD, XC);

figure; imagesc(triu(mi));
colormap(jet);
colorbar
% The MI helper places continuous variables before discrete variables.
order = [find(cndx(:)); find(~cndx(:))];
labels = data.varNames(order);
assert(numel(labels) == size(mi,1));
set(gca, 'xtick', 1:D, 'ytick', 1:D);
xticklabelRot(labels, 45, 9, 0)
set(gca,'yticklabel', labels, 'fontsize', 9);
title('pairwise mutual information in autompg data')
printPmtkFigure('miMixedDemoColor3')
