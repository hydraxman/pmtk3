#include <dai/util.h>
#include <dai/index.h>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

static void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    try {
        static_assert(sizeof(size_t) == 8, "Tests require the actual 64-bit target");
        const size_t values[] = {0, size_t(1)<<31, size_t(1)<<32,
                                size_t(1)<<63, std::numeric_limits<size_t>::max()};
        const char *decimal[] = {"0", "2147483648", "4294967296",
                                 "9223372036854775808", "18446744073709551615"};
        for (size_t i=0; i<5; ++i) {
            dai::BigInt imported = dai::size_t_BigInt(values[i]);
            require(imported.get_str() == decimal[i], "Import disagrees with decimal oracle");
            dai::BigInt independent(decimal[i]);
            require(dai::BigInt_size_t(independent) == values[i], "Export disagrees with native integer oracle");
        }
        const char *invalid[] = {"-1", "-18446744073709551616",
                                  "18446744073709551616", "340282366920938463463374607431768211456"};
        size_t rejected = 0;
        for (const char *text : invalid) {
            try {
                (void)dai::BigInt_size_t(dai::BigInt(text));
            } catch (const dai::Exception &error) {
                require(error.getCode() == dai::Exception::ASSERTION_FAILED,
                        "Upstream exception type/code changed");
                ++rejected;
            }
        }
        require(rejected == 4, "Negative/overflow conversion was not rejected");
        dai::Var a(0,size_t(1)<<32), b(1,size_t(1)<<31), c(2,size_t(1)<<32);
        dai::VarSet variables(a,b);
        require(variables.nrStates().get_str() == "9223372036854775808",
                "VarSet product lost upper bits");
        const size_t last = (size_t(1)<<63)-1;
        dai::State state(variables,dai::size_t_BigInt(last));
        require(state(a) == (size_t(1)<<32)-1 && state(b) == (size_t(1)<<31)-1,
                "State decomposition lost upper bits");
        require(dai::BigInt_size_t(state(variables)) == last, "State recomposition lost upper bits");
        require(dai::VarSet(a,c).nrStates().get_str() == "18446744073709551616",
                "Arbitrary-precision state product was narrowed");
        std::cout << "{\"passed\":true,\"size_t_bits\":64,\"unsigned_long_bits\":"
                  << 8*sizeof(unsigned long)
                  << ",\"boundary_values\":5,\"rejected_negative_and_overflow\":4,"
                  << "\"large_varset_and_state_roundtrip\":true}" << std::endl;
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << std::endl;
        return 1;
    }
}
