function product = max_mult(left, right)
% Pure-code max-times matrix product for the optional KPM MEX interface.
narginchk(2, 2);
if ~isa(left, 'double') || ~isa(right, 'double') || ...
        ~ismatrix(left) || ~ismatrix(right) || ~isreal(left) || ~isreal(right) || ...
        issparse(left) || issparse(right)
    error('max_mult:InvalidInput', 'Inputs must be real, full double matrices.');
end
if size(left, 2) ~= size(right, 1) || size(left, 2) == 0
    error('max_mult:Dimensions', 'Inner matrix dimensions must agree and be nonzero.');
end
product = bsxfun(@times, left(:,1), right(1,:));
for k = 2:size(left, 2)
    candidate = left(:,k)*right(k,:);
    larger = candidate > product;
    product(larger) = candidate(larger);
end
end
