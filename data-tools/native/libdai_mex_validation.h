#include "mex.h"
#include <cmath>
#include <limits>
#include <map>

static void pmtk_dai_validate(const mxArray *factors) {
    if (!mxIsCell(factors) || mxGetNumberOfElements(factors) == 0 ||
        (mxGetM(factors) != 1 && mxGetN(factors) != 1))
        mexErrMsgIdAndTxt("libDAI:Input", "Factors must be a nonempty linear cell array.");
    std::map<size_t,size_t> cardinalities;
    for (mwIndex i=0; i<mxGetNumberOfElements(factors); ++i) {
        const mxArray *factor = mxGetCell(factors,i);
        if (!factor || !mxIsStruct(factor) || mxGetNumberOfElements(factor) != 1)
            mexErrMsgIdAndTxt("libDAI:Input", "Each factor must be a scalar Member/P structure.");
        const mxArray *member = mxGetField(factor,0,"Member");
        const mxArray *table = mxGetField(factor,0,"P");
        if (!member || !table || !mxIsDouble(member) || mxIsComplex(member) || mxIsSparse(member) ||
            mxGetM(member) != 1 || mxGetN(member) == 0 ||
            !mxIsDouble(table) || mxIsComplex(table) || mxIsSparse(table) ||
            mxGetNumberOfElements(table) == 0 || mxGetN(member) > mxGetNumberOfDimensions(table))
            mexErrMsgIdAndTxt("libDAI:Input", "Member must be a double row and P a full real double tensor with matching dimensions.");
        const double *labels = mxGetPr(member);
        const mwSize *dimensions = mxGetDimensions(table);
        std::map<size_t,bool> local;
        size_t expected_elements=1;
        for (mwIndex j=0; j<mxGetN(member); ++j) {
            double label = labels[j];
            if (!std::isfinite(label) || label < 0 || std::floor(label) != label || label > 9007199254740991.0)
                mexErrMsgIdAndTxt("libDAI:Input", "Member labels must be exact nonnegative integers within double's consecutive-integer range.");
            size_t key = static_cast<size_t>(label);
            if (!dimensions[j] || local.count(key))
                mexErrMsgIdAndTxt("libDAI:Input", "Factor labels must be unique with positive state counts.");
            if (dimensions[j] > std::numeric_limits<size_t>::max()/expected_elements)
                mexErrMsgIdAndTxt("libDAI:Input", "Factor dimension product overflows size_t.");
            expected_elements *= dimensions[j];
            local[key] = true;
            if (cardinalities.count(key) && cardinalities[key] != static_cast<size_t>(dimensions[j]))
                mexErrMsgIdAndTxt("libDAI:Input", "A variable has inconsistent state counts across factors.");
            cardinalities[key] = dimensions[j];
        }
        if (expected_elements != mxGetNumberOfElements(table))
            mexErrMsgIdAndTxt("libDAI:Input", "P contains dimensions not described by Member (unary tables must be columns).");
        const double *values = mxGetPr(table);
        for (mwIndex j=0; j<mxGetNumberOfElements(table); ++j)
            if (!std::isfinite(values[j]) || values[j] < 0)
                mexErrMsgIdAndTxt("libDAI:Input", "Factor potentials must be finite and nonnegative.");
    }
}

static uint32_T pmtk_dai_map_state(size_t value) {
    if (value > std::numeric_limits<uint32_T>::max())
        mexErrMsgIdAndTxt("libDAI:MapWidth", "A MAP state cannot be represented by the upstream uint32 output contract.");
    return static_cast<uint32_T>(value);
}
