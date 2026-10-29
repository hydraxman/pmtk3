#include <mex.h>
#include <cstddef>
#include <type_traits>

// Compile-time assertions only: building this file does not run Octave/code.
static_assert(sizeof(void *) == 8, "Requires the verified 64-bit toolchain");
static_assert(sizeof(mwSize) == 8, "MEX dimension width must be 64 bits");
static_assert(sizeof(mwIndex) == 8, "MEX sparse index width must be 64 bits");
static_assert(sizeof(std::size_t) == 8, "C++ size_t must be 64 bits");
static_assert(std::is_same<decltype(mxGetDimensions(nullptr)), const mwSize *>::value,
              "MEX dimension pointer type must match mwSize");
