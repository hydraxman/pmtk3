// Included inside namespace dai, after the upstream BigInt typedef.
// Lossless native-word GMP interchange; no floating or unsigned-long casts.
inline BigInt size_t_BigInt( size_t value ) {
    BigInt result;
    mpz_import(result.get_mpz_t(), 1, 1, sizeof(value), 0, 0, &value);
    return result;
}

inline size_t BigInt_size_t( const BigInt &N ) {
    // Keep the upstream always-active DAI_ASSERT/dai::Exception mechanism.
    // Check BEFORE mpz_export, which otherwise could write multiple words.
    DAI_ASSERT( N >= 0 );
    const BigInt maximum = size_t_BigInt(std::numeric_limits<size_t>::max());
    DAI_ASSERT( N <= maximum );
    size_t result = 0;
    size_t words = 0;
    mpz_export(&result, &words, 1, sizeof(result), 0, 0, N.get_mpz_t());
    DAI_ASSERT( words <= 1 );
    return result;
}
