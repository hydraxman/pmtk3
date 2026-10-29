// GPL-2.0 compatibility gateway for the official GLMnet Fortran solver.
// Implements the existing PMTK 2009 14/15-input interface, not another solver.
// Mathematical routines remain byte-identical to the pinned Stanford release.
#include "mex.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

static_assert(sizeof(int) == 4 && sizeof(float) == 4, "Requires 32-bit Fortran INTEGER/REAL interoperability");
static_assert(sizeof(mwSize) == 8 && sizeof(mwIndex) == 8, "Requires audited 64-bit MEX dimensions/indices");
struct IncompletePath : std::runtime_error {using std::runtime_error::runtime_error;};
extern "C" {
void pmtk_glmnet_abi(int *,int *);
void elnet_(int*,float*,int*,int*,float*,float*,float*,int*,float*,float*,
            int*,int*,int*,float*,float*,float*,int*,int*,int*,int*,
            float*,float*,int*,int*,float*,float*,int*,int*);
void lognet_(float*,int*,int*,int*,float*,float*,float*,int*,float*,float*,
             int*,int*,int*,float*,float*,float*,int*,int*,int*,int*,int*,
             float*,float*,int*,int*,float*,float*,float*,int*,int*);
}

static void check(bool valid,const char *message) {
    if (!valid) throw std::invalid_argument(message);
}
static void real_array(const mxArray *value) {
    check(mxIsDouble(value) && !mxIsSparse(value) && !mxIsComplex(value),
          "The legacy GLMnet interface requires full real double arrays (sparse input is not claimed).");
}
static double scalar(const mxArray *value) {
    real_array(value);
    check(mxGetNumberOfElements(value)==1,"Expected a scalar GLMnet parameter.");
    double result=mxGetPr(value)[0];
    check(std::isfinite(result),"Scalar GLMnet parameters must be finite.");
    return result;
}
static float single_scalar(const mxArray *value) {
    double result=scalar(value);
    check(std::abs(result)<=std::numeric_limits<float>::max(),"Scalar exceeds the reviewed Fortran REAL32 range.");
    return static_cast<float>(result);
}
static int integer(const mxArray *value,int minimum) {
    double result=scalar(value);
    // Historical gateway converted MATLAB doubles to Fortran INTEGER by
    // truncation (not rounding); preserve that for pmax/dfmax arithmetic.
    check(result>=minimum && result<=std::numeric_limits<int>::max()-2,
          "Fortran INTEGER parameter is outside its checked int32 range.");
    return static_cast<int>(result);
}
static size_t product(size_t a,size_t b) {
    const size_t limit=std::numeric_limits<int>::max()-2;
    check(a<=limit && b<=limit && (a==0 || b<=limit/a),
          "Fortran array/index product exceeds signed int32 bounds.");
    return a*b;
}
static std::vector<float> reals(const mxArray *value,size_t expected) {
    real_array(value);
    check(mxGetNumberOfElements(value)==expected,"GLMnet input array length does not match its dimensions.");
    const double *input=mxGetPr(value);
    std::vector<float> result(expected);
    for(size_t i=0;i<expected;++i) {
        check(std::isfinite(input[i]) && std::abs(input[i])<=std::numeric_limits<float>::max(),
              "GLMnet REAL32 input cannot contain nonfinite or unrepresentable values.");
        result[i]=static_cast<float>(input[i]);
    }
    return result;
}
template<typename T>
static mxArray *output(const std::vector<T> &values,size_t rows,size_t columns) {
    mwSize dimensions[2]={static_cast<mwSize>(rows),static_cast<mwSize>(columns)};
    mxArray *result=mxCreateNumericArray(2,dimensions,mxDOUBLE_CLASS,mxREAL);
    double *destination=mxGetPr(result);
    for(size_t i=0;i<rows*columns;++i) destination[i]=values[i];
    return result;
}
static void implementation(int nlhs,mxArray *plhs[],int nrhs,const mxArray *prhs[]) {
    int integer_bits=0,real_bits=0;
    pmtk_glmnet_abi(&integer_bits,&real_bits);
    check(integer_bits==32 && real_bits==32,"The compiled Fortran default kinds do not match the reviewed INTEGER32/REAL32 ABI.");
    if(nrhs==1 && mxIsChar(prhs[0]) && nlhs==1) {
        const char *names[]={"integer_bits","real_bits","mex_dimension_bits","core"};
        plhs[0]=mxCreateStructMatrix(1,1,4,names);
        mxSetField(plhs[0],0,names[0],mxCreateDoubleScalar(integer_bits));
        mxSetField(plhs[0],0,names[1],mxCreateDoubleScalar(real_bits));
        mxSetField(plhs[0],0,names[2],mxCreateDoubleScalar(8*sizeof(mwSize)));
        mxSetField(plhs[0],0,names[3],mxCreateString("Official Stanford newGLMnet 2013-02-15, Matlab release 2014-04-28"));
        return;
    }
    const mxArray *controls=nullptr;
    if(nrhs>1 && mxIsStruct(prhs[nrhs-1])) {
        controls=prhs[--nrhs];
        check(mxGetNumberOfElements(controls)==1,"Octave path controls must be a scalar struct.");
        for(int i=0;i<mxGetNumberOfFields(controls);++i) {
            std::string name=mxGetFieldNameByNumber(controls,i);
            check(name=="max_passes" || name=="require_complete","Unknown Octave GLMnet path control.");
        }
    }
    check((nrhs==14 || nrhs==15) && (nlhs==8 || nlhs==9),
          "Expected legacy 14/15 inputs, optional Octave controls, and eight/nine outputs.");
    bool gaussian=nrhs==14;
    int maxit=gaussian?100000:integer(prhs[13],1);
    std::string limit_source=gaussian?"gaussian_bridge_default":"legacy_maxit_numeric_passthrough";
    bool require_complete=false;
    if(controls) {
        const mxArray *limit=mxGetField(controls,0,"max_passes");
        if(limit && mxGetNumberOfElements(limit)) {
            double value=scalar(limit);
            check(std::floor(value)==value,"Explicit whole-path max_passes must be an integer.");
            maxit=integer(limit,1);limit_source="explicit_octave_max_passes";
        }
        const mxArray *complete=mxGetField(controls,0,"require_complete");
        if(complete) {
            check((mxIsLogical(complete)||mxIsDouble(complete)) && !mxIsSparse(complete) &&
                  !mxIsComplex(complete) && mxGetNumberOfElements(complete)==1,
                  "require_complete must be a scalar boolean.");
            double value=mxGetScalar(complete);
            check(value==0 || value==1,"require_complete must be zero or one.");
            require_complete=value!=0;
        }
    }
    real_array(prhs[1]);
    check(mxGetNumberOfDimensions(prhs[1])==2,"X must be a matrix.");
    mwSize rows=mxGetM(prhs[1]),columns=mxGetN(prhs[1]);
    check(rows>=2 && columns>=1,"GLMnet requires at least two observations and one feature.");
    product(rows,columns);
    int no=static_cast<int>(rows),ni=static_cast<int>(columns);
    float alpha=single_scalar(prhs[0]);
    check(alpha>=0 && alpha<=1,"Elastic-net alpha must lie in [0,1].");
    int ne=integer(prhs[5],1),nx=integer(prhs[6],1),nlam=integer(prhs[7],1);
    float flmin=single_scalar(prhs[8]),threshold=single_scalar(prhs[10]);
    int isd=integer(prhs[11],0),nc=gaussian?1:integer(prhs[12],1);
    check(isd<=1 && flmin>=0 && threshold>0,"Invalid standardization/lambda/convergence controls.");
    check(flmin>=1 || nlam>=2,"Automatic lambda paths need at least two solutions.");
    size_t coefficient_count=product(product(nx,nc),nlam);
    product(no,std::max(2,nc));
    product(ni,nx);product(ni,nc); // internal covariance/multinomial workspaces also use INTEGER indexing
    std::vector<float> x=reals(prhs[1],product(no,ni));
    std::vector<float> y=reals(prhs[2],gaussian?static_cast<size_t>(no):product(no,std::max(2,nc)));
    std::vector<float> penalty=reals(prhs[4],ni);
    for(float value:penalty) check(value>=0,"Penalty factors must be nonnegative.");
    real_array(prhs[3]);
    check(mxGetNumberOfElements(prhs[3])>=1,"Missing exclusion-vector header.");
    const double *exclusions=mxGetPr(prhs[3]);
    check(std::isfinite(exclusions[0]) && exclusions[0]>=0 && exclusions[0]<=ni &&
          std::floor(exclusions[0])==exclusions[0],"Invalid exclusion count.");
    int deleted=static_cast<int>(exclusions[0]);
    check(mxGetNumberOfElements(prhs[3])==static_cast<mwSize>(deleted+1),"Exclusion-vector length mismatch.");
    std::vector<int> jd(deleted+1);jd[0]=deleted;
    for(int i=1;i<=deleted;++i) {
        check(std::isfinite(exclusions[i]) && exclusions[i]>=1 && exclusions[i]<=ni &&
              std::floor(exclusions[i])==exclusions[i],"Invalid excluded feature index.");
        jd[i]=static_cast<int>(exclusions[i]);
    }
    std::vector<float> lambdas(nlam,0);
    if(flmin>=1) {
        lambdas=reals(prhs[9],nlam);
        for(int i=0;i<nlam;++i)
            check(lambdas[i]>=0 && (i==0 || lambdas[i]<=lambdas[i-1]),
                  "Explicit lambdas must be nonnegative and nonincreasing.");
    }
    std::vector<float> bounds(product(2,ni));
    for(int i=0;i<ni;++i) {
        bounds[2*i]=-std::numeric_limits<float>::infinity();
        bounds[2*i+1]=std::numeric_limits<float>::infinity();
    }
    std::vector<float> intercept(product(nc,nlam),0),coefficients(coefficient_count,0);
    std::vector<int> active(nx,0),counts(nlam,0);
    std::vector<float> deviance(nlam,0),actual_lambda(nlam,0);
    int intr=1,lmu=0,nlp=0,jerr=0;
    if(gaussian) {
        std::vector<float> weights=reals(prhs[12],no);
        double sum=0;
        for(float weight:weights) {check(weight>=0,"Observation weights must be nonnegative.");sum+=weight;}
        check(sum>0,"Observation weights must have positive mass.");
        int ka=integer(prhs[13],1);
        check(ka<=2,"Gaussian algorithm must be covariance (1) or naive (2).");
        elnet_(&ka,&alpha,&no,&ni,x.data(),y.data(),weights.data(),jd.data(),penalty.data(),bounds.data(),
               &ne,&nx,&nlam,&flmin,lambdas.data(),&threshold,&isd,&intr,&maxit,&lmu,
               intercept.data(),coefficients.data(),active.data(),counts.data(),deviance.data(),
               actual_lambda.data(),&nlp,&jerr);
    } else {
        // Without explicit controls, preserve the legacy numeric argument.
        // It is NOT a source-justified translation of old outer iterations.
        int kopt=integer(prhs[14],0);check(kopt<=1,"Unknown logistic Hessian control.");
        for(float value:y) check(value>=0,"Logistic response counts must be nonnegative.");
        std::vector<float> offset(product(no,nc),0);
        float null_deviance=0;
        lognet_(&alpha,&no,&ni,&nc,x.data(),y.data(),offset.data(),jd.data(),penalty.data(),bounds.data(),
                &ne,&nx,&nlam,&flmin,lambdas.data(),&threshold,&isd,&intr,&maxit,&kopt,&lmu,
                intercept.data(),coefficients.data(),active.data(),counts.data(),&null_deviance,
                deviance.data(),actual_lambda.data(),&nlp,&jerr);
    }
    check(lmu>=0 && lmu<=nlam,"Native GLMnet returned an invalid solution count.");
    if(require_complete && (jerr!=0 || lmu!=nlam))
        throw IncompletePath("Requested complete lambda path was not obtained: jerr="+std::to_string(jerr)+
                             ", completed="+std::to_string(lmu)+"/"+std::to_string(nlam)+
                             ", whole-path max_passes="+std::to_string(maxit));
    for(int i=0;i<lmu;++i) check(counts[i]>=0 && counts[i]<=nx,"Native GLMnet returned an invalid active-set size.");
    plhs[0]=output(intercept,gaussian?lmu:nc,gaussian?1:lmu);
    plhs[1]=output(coefficients,product(nx,nc),lmu);
    plhs[2]=output(active,nx,1);
    plhs[3]=output(counts,lmu,1);
    plhs[4]=output(deviance,lmu,1);
    plhs[5]=output(actual_lambda,lmu,1);
    plhs[6]=mxCreateDoubleScalar(nlp);
    plhs[7]=mxCreateDoubleScalar(jerr); // preserve native convergence/error reporting, including partial paths
    if(nlhs==9) {
        const char *names[]={"max_passes","unit","limit_source","passes_used","requested_lambda_count",
                            "completed_lambda_count","jerr","require_complete"};
        plhs[8]=mxCreateStructMatrix(1,1,8,names);
        mxSetField(plhs[8],0,names[0],mxCreateDoubleScalar(maxit));
        mxSetField(plhs[8],0,names[1],mxCreateString("coordinate-descent passes over the whole lambda path"));
        mxSetField(plhs[8],0,names[2],mxCreateString(limit_source.c_str()));
        mxSetField(plhs[8],0,names[3],mxCreateDoubleScalar(nlp));
        mxSetField(plhs[8],0,names[4],mxCreateDoubleScalar(nlam));
        mxSetField(plhs[8],0,names[5],mxCreateDoubleScalar(lmu));
        mxSetField(plhs[8],0,names[6],mxCreateDoubleScalar(jerr));
        mxSetField(plhs[8],0,names[7],mxCreateLogicalScalar(require_complete));
    }
}
void mexFunction(int nlhs,mxArray *plhs[],int nrhs,const mxArray *prhs[]) {
    try { implementation(nlhs,plhs,nrhs,prhs); }
    catch(const IncompletePath &error) {mexErrMsgIdAndTxt("PMTK:GlmnetIncompletePath","%s",error.what());}
    catch(const std::exception &error) {mexErrMsgIdAndTxt("PMTK:GlmnetABI","%s",error.what());}
}
