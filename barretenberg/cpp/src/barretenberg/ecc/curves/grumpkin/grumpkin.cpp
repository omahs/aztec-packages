#include "./grumpkin.hpp"

namespace grumpkin {
namespace {

<<<<<<< HEAD:circuits/cpp/barretenberg/cpp/src/barretenberg/ecc/curves/grumpkin/grumpkin.cpp
// constexpr size_t max_num_generators = 1 << 10;
// static std::array<g1::affine_element, max_num_generators> generators;
// static bool init_generators = false;
=======
constexpr size_t max_num_generators = 1 << 10;
// NOLINTNEXTLINE TODO(@zac-williamson) #1806 get rid of need for these static variables in Pedersen refactor!
static std::array<g1::affine_element, max_num_generators> generators;
// NOLINTNEXTLINE TODO(@zac-williamson) #1806 get rid of need for these static variables in Pedersen refactor!
static bool init_generators = false;
>>>>>>> origin/master:barretenberg/cpp/src/barretenberg/ecc/curves/grumpkin/grumpkin.cpp

} // namespace
// g1::affine_element get_generator(const size_t generator_index)
// {
//     if (!init_generators) {
//         generators = g1::derive_generators<max_num_generators>();
//         init_generators = true;
//     }
//     ASSERT(generator_index < max_num_generators);
//     return generators[generator_index];
// }
} // namespace grumpkin