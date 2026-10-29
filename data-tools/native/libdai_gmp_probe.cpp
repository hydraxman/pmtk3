#include <gmpxx.h>
#include <cstddef>
#include <limits>
#include <utility>

// Compile only. libDAI's original BigInt_size_t calls get_ui(); its result
// must not narrow a 64-bit size_t on Windows LLP64.
using gmp_uint_result = decltype(std::declval<const mpz_class &>().get_ui());
static_assert(sizeof(gmp_uint_result) >= sizeof(std::size_t),
              "libDAI BigInt_size_t would truncate bundled GMP get_ui on LLP64");
void pmtk_libdai_gmp_width_probe()
{
    mpz_class exact(std::numeric_limits<std::size_t>::max());
    (void)exact;
}
