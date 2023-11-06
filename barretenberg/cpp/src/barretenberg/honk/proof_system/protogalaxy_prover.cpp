#include "protogalaxy_prover.hpp"
#include "barretenberg/flavor/flavor.hpp"
namespace proof_system::honk {

template <class ProverInstances> void ProtoGalaxyProver_<ProverInstances>::prepare_for_folding()
{
    auto idx = 0;
    for (auto it = instances.begin(); it != instances.end(); it++, idx++) {
        auto instance = *it;
        instance->initialise_prover_polynomials();

        auto domain_separator = std::to_string(idx);
        const auto circuit_size = static_cast<uint32_t>(instance->proving_key->circuit_size);
        const auto num_public_inputs = static_cast<uint32_t>(instance->proving_key->num_public_inputs);

        transcript.send_to_verifier(domain_separator + "_circuit_size", circuit_size);
        transcript.send_to_verifier(domain_separator + "_public_input_size", num_public_inputs);
        transcript.send_to_verifier(domain_separator + "_pub_inputs_offset",
                                    static_cast<uint32_t>(instance->pub_inputs_offset));

        for (size_t i = 0; i < instance->proving_key->num_public_inputs; ++i) {
            auto public_input_i = instance->public_inputs[i];
            transcript.send_to_verifier(domain_separator + "_public_input_" + std::to_string(i), public_input_i);
        }

        // TODO(https://github.com/AztecProtocol/barretenberg/issues/752): establish whether we can use the same
        // grand product parameters for all instances securely
        auto [eta, beta, gamma] = transcript.get_challenges(
            domain_separator + "_eta", domain_separator + "_beta", domain_separator + "_gamma");
        instance->compute_sorted_accumulator_polynomials(eta);
        instance->compute_grand_product_polynomials(beta, gamma);
    }

    fold_parameters(instances);
}

// TODO(#https://github.com/AztecProtocol/barretenberg/issues/689): finalise implementation this function
template <class ProverInstances>
ProverFoldingResult<typename ProverInstances::Flavor> ProtoGalaxyProver_<ProverInstances>::fold_instances()
{
    prepare_for_folding();
    // TODO(#https://github.com/AztecProtocol/barretenberg/issues/740): Handle the case where we are folding for the
    // first time and accumulator is 0
    auto [alpha, delta] = transcript.get_challenges("alpha", "delta");
    auto accumulator = get_accumulator();
    auto instance_size = accumulator->prover_polynomials[0].size();
    const auto log_instance_size = static_cast<size_t>(numeric::get_msb(instance_size));
    auto deltas = compute_round_challenge_pows(log_instance_size, delta);
    // This is not OK here
    auto perturbator = compute_perturbator(accumulator, deltas, alpha);
    for (size_t idx = 0; idx <= log_instance_size; idx++) {
        transcript.send_to_verifier("perturbator_" + std::to_string(idx), perturbator[idx]);
    }

    auto perturbator_challenge = transcript.get_challenge("perturbator_challenge");
    auto compressed_perturbator = perturbator.evaluate(perturbator_challenge);
    std::vector<FF> betas_star(log_instance_size);
    betas_star[0] = 1;
    auto betas = accumulator->folding_parameters.gate_separation_challenges;
    for (size_t idx = 1; idx < log_instance_size; idx++) {
        betas_star[idx] = betas[idx] + perturbator_challenge * deltas[idx - 1];
    }

    auto pow_betas_star = compute_pow_polynomial_at_values(betas_star, instance_size);

    auto combiner = compute_combiner(instances, pow_betas_star, alpha);
    auto combiner_quotient = compute_combiner_quotient(compressed_perturbator, combiner);
    for (size_t idx = ProverInstances::NUM; idx < combiner.size(); idx++) {
        transcript.send_to_verifier("combiner_quotient_" + std::to_string(idx), combiner_quotient.value_at(idx));
    }
    auto combiner_challenge = transcript.get_challenge("combiner_qoutient_challenge");
    auto combiner_quotient_at_challenge = combiner_quotient.evaluate(combiner_challenge);
    auto vanishing_polynomial_at_challenge = combiner_challenge * (combiner_challenge - FF(1));
    auto lagrange_0_at_challenge = FF(1) - combiner_challenge;
    // auto lagrange_1_at_challenge = combiner_challenge;
    auto new_target_sum = compressed_perturbator * lagrange_0_at_challenge +
                          vanishing_polynomial_at_challenge * combiner_quotient_at_challenge;

    // for (size_t idx = 0; idx < accumulator->prover_polynomials.size(); idx++) {
    //     auto accumulator_poly = accumulator->prover_polynomials[idx];
    //     auto instance_poly = accumulator->prover_polynomials[idx];
    //     assert(accumulator_poly.size() == instance_poly.size());
    //     for (size_t j = 0; j < accumulator_poly.size(); j++) {
    //         accumulator_poly[j] =
    //             accumulator_poly[j] * lagrange_0_at_challenge + instance_poly[j] * lagrange_1_at_challenge;
    //     }
    // }

    // i have dk evaluations out of which the first k are not good so we evaluate the rest of the polynomials from
    // k+1

    // we do barycentric evaluation on the combiner

    ProverFoldingResult<Flavor> res;
    // res.folded_prover_polynomials = accumulator->prover_polynomials;
    res.params.target_sum = new_target_sum;
    // res.params.gate_separation_challenges = betas_star;
    res.folding_data = transcript.proof_data;
    return res;
}
template class ProtoGalaxyProver_<ProverInstances_<honk::flavor::Ultra, 2>>;
template class ProtoGalaxyProver_<ProverInstances_<honk::flavor::GoblinUltra, 2>>;
} // namespace proof_system::honk