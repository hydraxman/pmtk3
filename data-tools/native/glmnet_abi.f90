subroutine pmtk_glmnet_abi(integer_bits, real_bits) bind(C, name="pmtk_glmnet_abi")
  use iso_c_binding
  implicit none
  integer(c_int), intent(out) :: integer_bits, real_bits
  integer :: native_integer
  real :: native_real
  integer_bits = storage_size(native_integer)
  real_bits = storage_size(native_real)
end subroutine
