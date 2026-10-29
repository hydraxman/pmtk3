// Input/ABI guard only; dictionary-learning implementation is upstream SPAMS.
#include "mex.h"
#include <cmath>
#include <limits>
#include <stdexcept>
static_assert(sizeof(mwSize)==8 && sizeof(mwIndex)==8,"Reviewed 64-bit MEX ABI required");
static void spams_check(bool ok,const char *message) {if(!ok)throw std::invalid_argument(message);}
static size_t spams_product(size_t a,size_t b) {
    size_t limit=std::numeric_limits<int>::max()-2;
    spams_check(a<=limit && b<=limit && (!a || b<=limit/a),"SPAMS array/index product exceeds checked INTEGER32 bounds");
    return a*b;
}
static double spams_scalar(const mxArray *p,const char *name,double fallback,bool required=false) {
    const mxArray *a=mxGetField(p,0,name);
    if(!a) {spams_check(!required,"Missing required SPAMS parameter");return fallback;}
    spams_check((mxIsDouble(a)||mxIsLogical(a))&&!mxIsComplex(a)&&!mxIsSparse(a)&&mxGetNumberOfElements(a)==1,
                "SPAMS parameters must be real scalar doubles/logicals");
    double v=mxGetScalar(a);spams_check(std::isfinite(v),"Nonfinite SPAMS parameter");return v;
}
static int spams_integer(const mxArray *p,const char *name,int fallback,bool required=false) {
    double v=spams_scalar(p,name,fallback,required);
    spams_check(std::floor(v)==v && v>=-2147483646.0 && v<=2147483645.0,"SPAMS integer parameter exceeds checked INTEGER32 bounds");
    return static_cast<int>(v);
}
static void spams_dense(const mxArray *a,size_t rows,size_t columns) {
    spams_check(a&&mxIsDouble(a)&&!mxIsComplex(a)&&!mxIsSparse(a)&&mxGetNumberOfDimensions(a)==2,
                "Reviewed SPAMS gateway currently accepts dense real double matrices only");
    spams_check(mxGetM(a)==rows&&mxGetN(a)==columns,"SPAMS matrix dimensions do not match");
    size_t n=spams_product(rows,columns);const double *data=mxGetPr(a);
    for(size_t i=0;i<n;++i)spams_check(std::isfinite(data[i]),"SPAMS input contains nonfinite values");
}
static void spams_validate(int nlhs,int nrhs,const mxArray *p[]) {
    spams_check(nrhs>=2&&nrhs<=3&&nlhs>=1&&nlhs<=2,"Expected genuine mexTrainDL(X,param[,model]) with one/two outputs");
    spams_check(mxIsStruct(p[1])&&mxGetNumberOfElements(p[1])==1,"SPAMS param must be a scalar struct");
    size_t n=mxGetM(p[0]),m=mxGetN(p[0]);spams_check(n&&m,"SPAMS data must be nonempty");
    spams_dense(p[0],n,m);
    const mxArray *d=mxGetField(p[1],0,"D");
    if(d)spams_product(n,mxGetN(d));
    int k=d?static_cast<int>(mxGetN(d)):spams_integer(p[1],"K",0,true);
    if(d) {spams_product(n,mxGetN(d));spams_dense(d,n,mxGetN(d));}
    spams_check(k>0,"SPAMS dictionary must contain positive atom count");
    spams_product(n,k);spams_product(k,k);
    int batch=spams_integer(p[1],"batchsize",512);spams_check(batch>0,"SPAMS batch size must be positive");
    spams_product(k,batch);spams_product(n,batch);
    (void)spams_integer(p[1],"iter",0,true);
    (void)spams_integer(p[1],"numThreads",-1);
    (void)spams_integer(p[1],"mode",2);(void)spams_integer(p[1],"modeD",0);
    (void)spams_integer(p[1],"modeParam",0);
    spams_check(spams_scalar(p[1],"lambda",0,true)>=0,"SPAMS lambda must be nonnegative");
    spams_check(!spams_scalar(p[1],"log_deprecated",0),"Legacy file logging is not enabled by this confined provider");
    if(nrhs==3) {
        spams_check(d&&mxIsStruct(p[2])&&mxGetNumberOfElements(p[2])==1,"Warm-start model requires D and scalar model");
        spams_dense(mxGetField(p[2],0,"A"),k,k);spams_dense(mxGetField(p[2],0,"B"),n,k);
        (void)spams_integer(p[2],"iter",0,true);
    }
}
