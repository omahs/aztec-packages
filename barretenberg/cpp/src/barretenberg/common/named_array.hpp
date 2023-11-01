#pragma once

/* The following code should meet a *reasonable reading* of the C++ standard.
 * It relies on heuristics to check that a struct is packed and consisting of only one type,
 * allowing to use the struct in an array-like manner, while being able to access its fields with names.
 * This should meet all modern compilers, there's no reason for random padding to exist in the struct. */

#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include <cstdint>
#include <tuple>
#include <utility>

template <typename T, std::size_t N> struct TupleGenerator {
    using type = decltype(std::tuple_cat(std::declval<std::tuple<T>>(), typename TupleGenerator<T, N - 1>::type{}));
};

template <typename T> struct TupleGenerator<T, 1> {
    using type = std::tuple<T>;
};

// Since this is just a concept, it's nice to ignore Wmissing-braces so we can
// check for ArrayLike types that extend from one another without warnings
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wmissing-braces"
// A concept that says: This class has the same layout as std::array<T, N>
// It uses basic size math and heuristics about the available constructor to achieve this.
// The class should NOT define a constructor.
template <typename Struct, typename T, std::size_t N>
concept ArrayLike_ =
    requires(Struct a, T t) {
        typename TupleGenerator<T, N>::type;
        // It takes a constructor of N arguments -> proxy for checking that it has N members of type T
        Struct{ std::apply([](auto... args) { return Struct{ args... }; }, typename TupleGenerator<T, N>::type{}) };
        // Check padding
        requires sizeof(Struct) == N * sizeof(T);
    };
#pragma clang diagnostic pop

template <typename Struct>
concept ArrayLike =
    requires(Struct a) {
        requires ArrayLike_<Struct, typename Struct::Element, sizeof(Struct) / sizeof(typename Struct::Element)>;
    };

template <typename T> inline std::span<T> inclusive_member_range_span(T& start, T& end)
{
    return std::span<T>{ &start, &end + 1 };
}

struct X {
    using Element = barretenberg::fr;
    // index 0
    barretenberg::fr x;
    // index 1
    barretenberg::fr y;
    // index 2
    barretenberg::fr z;
};

struct Y : X {
    // index 3
    barretenberg::fr z2;
};
static_assert(ArrayLike<Y>, "X is configured");

template <ArrayLike T> inline auto as_array(T& obj)
{
    using Element = T::Element;
    // NOLINTBEGIN(cppcoreguidelines-pro-type-reinterpret-cast)
    // We can make the assumption that there's no padding at the end of the object because of our
    // ArrayLike concept.
    return std::span{ reinterpret_cast<Element*>(&obj), reinterpret_cast<Element*>(&obj + 1) };
    // NOLINTEND(cppcoreguidelines-pro-type-reinterpret-cast)
}