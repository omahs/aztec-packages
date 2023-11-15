

#pragma once
#include "barretenberg/ecc/curves/bn254/g1.hpp"
#include "barretenberg/honk/pcs/kzg/kzg.hpp"
#include "barretenberg/polynomials/barycentric.hpp"
#include "barretenberg/polynomials/univariate.hpp"

#include "barretenberg/honk/transcript/transcript.hpp"
#include "barretenberg/polynomials/evaluation_domain.hpp"
#include "barretenberg/polynomials/polynomial.hpp"
// #include "barretenberg/proof_system/circuit_builder/ultra_circuit_builder.hpp"
#include "barretenberg/proof_system/flavor/flavor.hpp"
#include "barretenberg/proof_system/relations/generated/AvmMini.hpp"

namespace proof_system::honk {
namespace flavor {

template <typename CycleGroup_T, typename Curve_T, typename PCS_T> class AvmMiniFlavorBase {
  public:
    // forward template params into the ECCVMBase namespace
    using CycleGroup = CycleGroup_T;
    using Curve = Curve_T;
    using G1 = typename Curve::Group;
    using PCS = PCS_T;

    using FF = typename G1::subgroup_field;
    using Polynomial = barretenberg::Polynomial<FF>;
    using PolynomialHandle = std::span<FF>;
    using GroupElement = typename G1::element;
    using Commitment = typename G1::affine_element;
    using CommitmentHandle = typename G1::affine_element;
    using CommitmentKey = pcs::CommitmentKey<Curve>;
    using VerifierCommitmentKey = pcs::VerifierCommitmentKey<Curve>;

    static constexpr size_t NUM_WIRES = 12;
    static constexpr size_t NUM_PRECOMPUTED_ENTITIES = 0; // This is zero for now
    static constexpr size_t NUM_WITNESS_ENTITIES = 12;
    // We have two copies of the witness entities, so we subtract the number of fixed ones (they have no shift), one for
    // the unshifted and one for the shifted
    static constexpr size_t NUM_ALL_ENTITIES = 15;

    // using GrandProductRelations = std::tuple<>;
    using Relations = std::tuple<AvmMini_vm::AvmMini<FF>>;
    // using LookupRelation = sumcheck::LookupRelation<FF>;

    static constexpr size_t MAX_RELATION_LENGTH = get_max_relation_length<Relations>();
    static constexpr size_t MAX_RANDOM_RELATION_LENGTH = MAX_RELATION_LENGTH + 1;
    static constexpr size_t NUM_RELATIONS = std::tuple_size<Relations>::value;

    // define the containers for storing the contributions from each relation in Sumcheck
    using TupleOfTuplesOfUnivariates = decltype(create_relation_univariates_container<FF, Relations>());
    using TupleOfArraysOfValues = decltype(create_relation_values_container<FF, Relations>());

  private:
    template <typename DataType, typename HandleType>
    class PrecomputedEntities : public PrecomputedEntities_<DataType, HandleType, NUM_PRECOMPUTED_ENTITIES> {
      public:
        std::vector<HandleType> get_selectors() override { return {}; };
        std::vector<HandleType> get_sigma_polynomials() override { return {}; };
        std::vector<HandleType> get_id_polynomials() override { return {}; };
        std::vector<HandleType> get_table_polynomials() { return {}; };
    };

    template <typename DataType, typename HandleType>
    class WitnessEntities : public WitnessEntities_<DataType, HandleType, NUM_WITNESS_ENTITIES> {
      public:
        DataType& avmMini_clk = std::get<0>(this->_data);
        DataType& avmMini_positive = std::get<1>(this->_data);
        DataType& avmMini_first = std::get<2>(this->_data);
        DataType& avmMini_subop = std::get<3>(this->_data);
        DataType& avmMini_inter_idx = std::get<4>(this->_data);
        DataType& avmMini_mem_idx = std::get<5>(this->_data);
        DataType& avmMini_last = std::get<6>(this->_data);
        DataType& avmMini_m_clk = std::get<7>(this->_data);
        DataType& avmMini_m_addr = std::get<8>(this->_data);
        DataType& avmMini_m_val = std::get<9>(this->_data);
        DataType& avmMini_m_lastAccess = std::get<10>(this->_data);
        DataType& avmMini_m_rw = std::get<11>(this->_data);

        std::vector<HandleType> get_wires() override
        {
            return {
                avmMini_clk,  avmMini_positive, avmMini_first,  avmMini_subop, avmMini_inter_idx,    avmMini_mem_idx,
                avmMini_last, avmMini_m_clk,    avmMini_m_addr, avmMini_m_val, avmMini_m_lastAccess, avmMini_m_rw,

            };
        };

        std::vector<HandleType> get_sorted_polynomials() { return {}; };
    };

    template <typename DataType, typename HandleType>
    class AllEntities : public AllEntities_<DataType, HandleType, NUM_ALL_ENTITIES> {
      public:
        DataType& avmMini_clk = std::get<0>(this->_data);
        DataType& avmMini_positive = std::get<1>(this->_data);
        DataType& avmMini_first = std::get<2>(this->_data);
        DataType& avmMini_subop = std::get<3>(this->_data);
        DataType& avmMini_inter_idx = std::get<4>(this->_data);
        DataType& avmMini_mem_idx = std::get<5>(this->_data);
        DataType& avmMini_last = std::get<6>(this->_data);
        DataType& avmMini_m_clk = std::get<7>(this->_data);
        DataType& avmMini_m_addr = std::get<8>(this->_data);
        DataType& avmMini_m_val = std::get<9>(this->_data);
        DataType& avmMini_m_lastAccess = std::get<10>(this->_data);
        DataType& avmMini_m_rw = std::get<11>(this->_data);

        DataType& avmMini_m_val_shift = std::get<12>(this->_data);
        DataType& avmMini_m_rw_shift = std::get<13>(this->_data);
        DataType& avmMini_m_addr_shift = std::get<14>(this->_data);

        std::vector<HandleType> get_wires() override
        {
            return {
                avmMini_clk,          avmMini_positive, avmMini_first, avmMini_subop,  avmMini_inter_idx,
                avmMini_mem_idx,      avmMini_last,     avmMini_m_clk, avmMini_m_addr, avmMini_m_val,
                avmMini_m_lastAccess, avmMini_m_rw,     avmMini_m_val, avmMini_m_rw,   avmMini_m_addr,

            };
        };

        std::vector<HandleType> get_unshifted() override
        {
            return {
                avmMini_clk,  avmMini_positive, avmMini_first,  avmMini_subop, avmMini_inter_idx,    avmMini_mem_idx,
                avmMini_last, avmMini_m_clk,    avmMini_m_addr, avmMini_m_val, avmMini_m_lastAccess, avmMini_m_rw,

            };
        };

        std::vector<HandleType> get_to_be_shifted() override
        {
            return {
                avmMini_m_val,
                avmMini_m_rw,
                avmMini_m_addr,

            };
        };

        std::vector<HandleType> get_shifted() override
        {
            return {
                avmMini_m_val_shift,
                avmMini_m_rw_shift,
                avmMini_m_addr_shift,

            };
        };

        AllEntities() = default;

        AllEntities(const AllEntities& other)
            : AllEntities_<DataType, HandleType, NUM_ALL_ENTITIES>(other){};

        AllEntities(AllEntities&& other) noexcept
            : AllEntities_<DataType, HandleType, NUM_ALL_ENTITIES>(other){};

        AllEntities& operator=(const AllEntities& other)
        {
            if (this == &other) {
                return *this;
            }
            AllEntities_<DataType, HandleType, NUM_ALL_ENTITIES>::operator=(other);
            return *this;
        }

        AllEntities& operator=(AllEntities&& other) noexcept
        {
            AllEntities_<DataType, HandleType, NUM_ALL_ENTITIES>::operator=(other);
            return *this;
        }

        ~AllEntities() override = default;
    };

  public:
    class ProvingKey : public ProvingKey_<PrecomputedEntities<Polynomial, PolynomialHandle>,
                                          WitnessEntities<Polynomial, PolynomialHandle>> {
      public:
        // Expose constructors on the base class
        using Base = ProvingKey_<PrecomputedEntities<Polynomial, PolynomialHandle>,
                                 WitnessEntities<Polynomial, PolynomialHandle>>;
        using Base::Base;

        // The plookup wires that store plookup read data.
        std::array<PolynomialHandle, 0> get_table_column_wires() { return {}; };
    };

    using VerificationKey = VerificationKey_<PrecomputedEntities<Commitment, CommitmentHandle>>;

    using ProverPolynomials = AllEntities<PolynomialHandle, PolynomialHandle>;

    using FoldedPolynomials = AllEntities<std::vector<FF>, PolynomialHandle>;

    class AllValues : public AllEntities<FF, FF> {
      public:
        using Base = AllEntities<FF, FF>;
        using Base::Base;
        AllValues(std::array<FF, NUM_ALL_ENTITIES> _data_in) { this->_data = _data_in; }
    };

    class AllPolynomials : public AllEntities<Polynomial, PolynomialHandle> {
      public:
        AllValues get_row(const size_t row_idx) const
        {
            AllValues result;
            size_t column_idx = 0; // // TODO(https://github.com/AztecProtocol/barretenberg/issues/391) zip
            for (auto& column : this->_data) {
                result[column_idx] = column[row_idx];
                column_idx++;
            }
            return result;
        }
    };

    using RowPolynomials = AllEntities<FF, FF>;

    class PartiallyEvaluatedMultivariates : public AllEntities<Polynomial, PolynomialHandle> {
      public:
        PartiallyEvaluatedMultivariates() = default;
        PartiallyEvaluatedMultivariates(const size_t circuit_size)
        {
            // Storage is only needed after the first partial evaluation, hence polynomials of size (n / 2)
            for (auto& poly : this->_data) {
                poly = Polynomial(circuit_size / 2);
            }
        }
    };

    template <size_t MAX_RELATION_LENGTH>
    using ExtendedEdges = AllEntities<barretenberg::Univariate<FF, MAX_RELATION_LENGTH>,
                                      barretenberg::Univariate<FF, MAX_RELATION_LENGTH>>;

    class ClaimedEvaluations : public AllEntities<FF, FF> {
      public:
        using Base = AllEntities<FF, FF>;
        using Base::Base;
        ClaimedEvaluations(std::array<FF, NUM_ALL_ENTITIES> _data_in) { this->_data = _data_in; }
    };

    class CommitmentLabels : public AllEntities<std::string, std::string> {
      private:
        using Base = AllEntities<std::string, std::string>;

      public:
        CommitmentLabels()
            : AllEntities<std::string, std::string>()
        {
            Base::avmMini_clk = "avmMini_clk";
            Base::avmMini_positive = "avmMini_positive";
            Base::avmMini_first = "avmMini_first";
            Base::avmMini_subop = "avmMini_subop";
            Base::avmMini_inter_idx = "avmMini_inter_idx";
            Base::avmMini_mem_idx = "avmMini_mem_idx";
            Base::avmMini_last = "avmMini_last";
            Base::avmMini_m_clk = "avmMini_m_clk";
            Base::avmMini_m_addr = "avmMini_m_addr";
            Base::avmMini_m_val = "avmMini_m_val";
            Base::avmMini_m_lastAccess = "avmMini_m_lastAccess";
            Base::avmMini_m_rw = "avmMini_m_rw";
        };
    };

    class VerifierCommitments : public AllEntities<Commitment, CommitmentHandle> {
      private:
        using Base = AllEntities<Commitment, CommitmentHandle>;

      public:
        VerifierCommitments(const std::shared_ptr<VerificationKey>& verification_key,
                            const VerifierTranscript<FF>& transcript)
        {
            static_cast<void>(transcript);
            static_cast<void>(verification_key);
        }
    };
};

class AvmMiniFlavor : public AvmMiniFlavorBase<grumpkin::g1, curve::BN254, pcs::kzg::KZG<curve::BN254>> {};

} // namespace flavor
} // namespace proof_system::honk
