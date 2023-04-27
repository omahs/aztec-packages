import {
  AppendOnlyTreeSnapshot,
  BaseOrMergeRollupPublicInputs,
  BaseRollupInputs,
  CircuitsWasm,
  Fr,
  PublicDataRead,
  PublicDataWrite,
  RootRollupPublicInputs,
  UInt8Vector,
} from '@aztec/circuits.js';
import { computeContractLeaf } from '@aztec/circuits.js/abis';
import {
  fr,
  makeBaseRollupPublicInputs,
  makeKernelPublicInputs,
  makeNewContractData,
  makeProof,
  makeRootRollupPublicInputs,
} from '@aztec/circuits.js/factories';
import { toBufferBE } from '@aztec/foundation';
import { Tx } from '@aztec/types';
import { MerkleTreeId, MerkleTreeOperations, MerkleTrees } from '@aztec/world-state';
import { MockProxy, mock } from 'jest-mock-extended';
import { default as levelup } from 'levelup';
import flatMap from 'lodash.flatmap';
import times from 'lodash.times';
import { default as memdown, type MemDown } from 'memdown';
import { makeEmptyUnverifiedData, makePublicTx } from '../mocks/tx.js';
import { VerificationKeys, getVerificationKeys } from '../mocks/verification_keys.js';
import { EmptyRollupProver } from '../prover/empty.js';
import { RollupProver } from '../prover/index.js';
import { ProcessedTx, makeEmptyProcessedTx, makeProcessedTx } from '../sequencer/processed_tx.js';
import { RollupSimulator } from '../simulator/index.js';
import { WasmRollupCircuitSimulator } from '../simulator/rollup.js';
import { CircuitBlockBuilder } from './circuit_block_builder.js';
import { makePrivateTx } from '../index.js';

export const createMemDown = () => (memdown as any)() as MemDown<any, any>;

describe('sequencer/circuit_block_builder', () => {
  let builder: TestSubject;
  let builderDb: MerkleTreeOperations;
  let expectsDb: MerkleTreeOperations;
  let vks: VerificationKeys;

  let simulator: MockProxy<RollupSimulator>;
  let prover: MockProxy<RollupProver>;

  let blockNumber: number;
  let baseRollupOutputLeft: BaseOrMergeRollupPublicInputs;
  let baseRollupOutputRight: BaseOrMergeRollupPublicInputs;
  let rootRollupOutput: RootRollupPublicInputs;

  let wasm: CircuitsWasm;

  const emptyProof = new UInt8Vector(Buffer.alloc(32, 0));

  beforeAll(async () => {
    wasm = await CircuitsWasm.get();
  });

  beforeEach(async () => {
    blockNumber = 3;
    builderDb = await MerkleTrees.new(levelup(createMemDown())).then(t => t.asLatest());
    expectsDb = await MerkleTrees.new(levelup(createMemDown())).then(t => t.asLatest());
    vks = getVerificationKeys();
    simulator = mock<RollupSimulator>();
    prover = mock<RollupProver>();
    builder = new TestSubject(builderDb, vks, simulator, prover);

    // Populate root trees with first roots from the empty trees
    // TODO: Should this be responsibility of the MerkleTreeDb init?
    await updateRootTrees();

    // Create mock outputs for simualator
    baseRollupOutputLeft = makeBaseRollupPublicInputs();
    baseRollupOutputRight = makeBaseRollupPublicInputs();
    rootRollupOutput = makeRootRollupPublicInputs();

    // Set up mocks
    prover.getBaseRollupProof.mockResolvedValue(emptyProof);
    prover.getRootRollupProof.mockResolvedValue(emptyProof);
    simulator.baseRollupCircuit
      .mockResolvedValueOnce(baseRollupOutputLeft)
      .mockResolvedValueOnce(baseRollupOutputRight);
    simulator.rootRollupCircuit.mockResolvedValue(rootRollupOutput);
  }, 20_000);

  const updateRootTrees = async () => {
    for (const [newTree, rootTree] of [
      [MerkleTreeId.PRIVATE_DATA_TREE, MerkleTreeId.PRIVATE_DATA_TREE_ROOTS_TREE],
      [MerkleTreeId.CONTRACT_TREE, MerkleTreeId.CONTRACT_TREE_ROOTS_TREE],
    ] as const) {
      const newTreeInfo = await expectsDb.getTreeInfo(newTree);
      await expectsDb.appendLeaves(rootTree, [newTreeInfo.root]);
    }
  };

  // Updates the expectedDb trees based on the new commitments, contracts, and nullifiers from these txs
  const updateExpectedTreesFromTxs = async (txs: ProcessedTx[]) => {
    const newContracts = flatMap(txs, tx => tx.data.end.newContracts.map(n => computeContractLeaf(wasm, n)));
    for (const [tree, leaves] of [
      [MerkleTreeId.PRIVATE_DATA_TREE, flatMap(txs, tx => tx.data.end.newCommitments.map(l => l.toBuffer()))],
      [MerkleTreeId.CONTRACT_TREE, newContracts.map(x => x.toBuffer())],
      [MerkleTreeId.NULLIFIER_TREE, flatMap(txs, tx => tx.data.end.newNullifiers.map(l => l.toBuffer()))],
    ] as const) {
      await expectsDb.appendLeaves(tree, leaves);
    }
    for (const write of txs.flatMap(tx => tx.data.end.stateTransitions)) {
      await expectsDb.updateLeaf(MerkleTreeId.PUBLIC_DATA_TREE, write.newValue.toBuffer(), write.leafIndex.value);
    }
  };

  const getTreeSnapshot = async (tree: MerkleTreeId) => {
    const treeInfo = await expectsDb.getTreeInfo(tree);
    return new AppendOnlyTreeSnapshot(Fr.fromBuffer(treeInfo.root), Number(treeInfo.size));
  };

  const setTxHistoricTreeRoots = async (tx: ProcessedTx) => {
    for (const [name, id] of [
      ['privateDataTreeRoot', MerkleTreeId.PRIVATE_DATA_TREE],
      ['contractTreeRoot', MerkleTreeId.CONTRACT_TREE],
      ['nullifierTreeRoot', MerkleTreeId.NULLIFIER_TREE],
    ] as const) {
      tx.data.constants.historicTreeRoots.privateHistoricTreeRoots[name] = Fr.fromBuffer(
        (await builderDb.getTreeInfo(id)).root,
      );
    }
  };

  describe('mock simulator', () => {
    it('builds an L2 block using mock simulator', async () => {
      // Create instance to test
      builder = new TestSubject(builderDb, vks, simulator, prover);
      await builder.updateRootTrees();

      // Assemble a fake transaction, we'll tweak some fields below
      const tx = await makeProcessedTx(
        Tx.createPrivate(makeKernelPublicInputs(), emptyProof, makeEmptyUnverifiedData()),
      );
      const txsLeft = [tx, await makeEmptyProcessedTx()];
      const txsRight = [await makeEmptyProcessedTx(), await makeEmptyProcessedTx()];

      // Set tree roots to proper values in the tx
      await setTxHistoricTreeRoots(tx);

      // Calculate what would be the tree roots after the txs from the first base rollup land and update mock circuit output
      await updateExpectedTreesFromTxs(txsLeft);
      baseRollupOutputLeft.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
      baseRollupOutputLeft.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
      baseRollupOutputLeft.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);
      baseRollupOutputLeft.endPublicDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PUBLIC_DATA_TREE);

      // Same for the two txs on the right
      await updateExpectedTreesFromTxs(txsRight);
      baseRollupOutputRight.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
      baseRollupOutputRight.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
      baseRollupOutputRight.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);
      baseRollupOutputRight.endPublicDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PUBLIC_DATA_TREE);

      // And update the root trees now to create proper output to the root rollup circuit
      await updateRootTrees();
      rootRollupOutput.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
      rootRollupOutput.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
      rootRollupOutput.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);
      rootRollupOutput.endPublicDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PUBLIC_DATA_TREE);
      rootRollupOutput.endTreeOfHistoricContractTreeRootsSnapshot = await getTreeSnapshot(
        MerkleTreeId.CONTRACT_TREE_ROOTS_TREE,
      );
      rootRollupOutput.endTreeOfHistoricPrivateDataTreeRootsSnapshot = await getTreeSnapshot(
        MerkleTreeId.PRIVATE_DATA_TREE_ROOTS_TREE,
      );

      // Actually build a block!
      const txs = [tx, await makeEmptyProcessedTx(), await makeEmptyProcessedTx(), await makeEmptyProcessedTx()];
      const [l2Block, proof] = await builder.buildL2Block(blockNumber, txs);

      expect(l2Block.number).toEqual(blockNumber);
      expect(proof).toEqual(emptyProof);
    }, 20000);

    // For varying orders of insertions assert the local batch insertion generator creates the correct proofs
    it.each([
      [[16, 15, 14, 13, 0, 0, 0, 0]],
      [[13, 14, 15, 16, 0, 0, 0, 0]],
      [[1234, 98, 0, 0, 99999, 88, 54, 0]],
      [[97, 98, 10, 0, 99999, 88, 100001, 9000000]],
    ] as const)('performs nullifier tree batch insertion correctly', async nullifiers => {
      const leaves = nullifiers.map(i => toBufferBE(BigInt(i), 32));
      await expectsDb.appendLeaves(MerkleTreeId.NULLIFIER_TREE, leaves);

      builder = new TestSubject(builderDb, vks, simulator, prover);

      await builder.performBaseRollupBatchInsertionProofs(leaves);

      const expected = await expectsDb.getTreeInfo(MerkleTreeId.NULLIFIER_TREE);
      const actual = await builderDb.getTreeInfo(MerkleTreeId.NULLIFIER_TREE);
      expect(actual).toEqual(expected);
    });
  });

  describe('circuits simulator', () => {
    beforeEach(async () => {
      const simulator = await WasmRollupCircuitSimulator.new();
      const prover = new EmptyRollupProver();
      builder = new TestSubject(builderDb, vks, simulator, prover);
      await builder.updateRootTrees();
    });

    const makeContractDeployProcessedTx = async (seed = 0x1) => {
      const tx = await makeEmptyProcessedTx();
      await setTxHistoricTreeRoots(tx);
      tx.data.end.newContracts = [makeNewContractData(seed + 0x1000)];
      return tx;
    };

    const makePublicCallProcessedTx = async (seed = 0x1) => {
      const publicTx = makePublicTx(seed);
      const tx = await makeProcessedTx(publicTx, makeKernelPublicInputs(seed), makeProof());
      await setTxHistoricTreeRoots(tx);
      tx.data.end.stateReads[0] = new PublicDataRead(fr(1), fr(0));
      tx.data.end.stateTransitions[0] = new PublicDataWrite(fr(2), fr(0), fr(12));
      return tx;
    };

    it.each([
      [0, 4],
      [1, 4],
      [4, 4],
      [0, 16],
      [16, 16],
    ] as const)(
      'builds an L2 block with %i contract deploy txs and %i txs total',
      async (deployCount: number, totalCount: number) => {
        const contractTreeBefore = await builderDb.getTreeInfo(MerkleTreeId.CONTRACT_TREE);

        const txs = [
          ...(await Promise.all(times(deployCount, makeContractDeployProcessedTx))),
          ...(await Promise.all(times(totalCount - deployCount, makeEmptyProcessedTx))),
        ];

        const [l2Block] = await builder.buildL2Block(blockNumber, txs);
        expect(l2Block.number).toEqual(blockNumber);

        await updateExpectedTreesFromTxs(txs);
        const contractTreeAfter = await builderDb.getTreeInfo(MerkleTreeId.CONTRACT_TREE);

        if (deployCount > 0) {
          expect(contractTreeAfter.root).not.toEqual(contractTreeBefore.root);
        }

        const expectedContractTreeAfter = await expectsDb.getTreeInfo(MerkleTreeId.CONTRACT_TREE).then(t => t.root);
        expect(contractTreeAfter.root).toEqual(expectedContractTreeAfter);
        expect(contractTreeAfter.size).toEqual(BigInt(totalCount));
      },
      10000,
    );

    it('builds an L2 block with private and public txs', async () => {
      const txs = await Promise.all([
        makeContractDeployProcessedTx(),
        makePublicCallProcessedTx(),
        makeEmptyProcessedTx(),
        makeEmptyProcessedTx(),
      ]);

      const [l2Block] = await builder.buildL2Block(blockNumber, txs);
      expect(l2Block.number).toEqual(blockNumber);

      // TODO: Check that l2 block got the new state transitions once we merge
      // https://github.com/AztecProtocol/aztec3-packages/pull/360

      await updateExpectedTreesFromTxs(txs);
    });

    // This test specifically tests nullifier values which previously caused e2e_zk_token test to fail
    it('e2e_zk_token edge case regression test on nullifier values', async () => {
      const simulator = await WasmRollupCircuitSimulator.new();
      const prover = new EmptyRollupProver();
      builder = new TestSubject(builderDb, vks, simulator, prover);
      // update the starting tree
      const updateVals = Array(16).fill(0n);
      updateVals[0] = 19777494491628650244807463906174285795660759352776418619064841306523677458742n;
      updateVals[1] = 10246291467305176436335175657884940686778521321101740385288169037814567547848n;

      await builder.updateRootTrees();
      await builderDb.appendLeaves(
        MerkleTreeId.NULLIFIER_TREE,
        updateVals.map(v => toBufferBE(v, 32)),
      );

      // new added values
      const tx = await makeEmptyProcessedTx();
      tx.data.end.newNullifiers[0] = new Fr(
        10336601644835972678500657502133589897705389664587188571002640950065546264856n,
      );
      tx.data.end.newNullifiers[1] = new Fr(
        17490072961923661940560522096125238013953043065748521735636170028491723851741n,
      );
      const txs = [tx, await makeEmptyProcessedTx(), await makeEmptyProcessedTx(), await makeEmptyProcessedTx()];

      const [l2Block] = await builder.buildL2Block(blockNumber, txs);
      expect(l2Block.number).toEqual(blockNumber);
    });

    it('Build blocks on top of blocks l2 block with 4 txs', async () => {
      const txs = [...(await Promise.all(times(4, makeEmptyProcessedTx)))];
      await builder.buildL2Block(1, txs);
      const [block] = await builder.buildL2Block(2, txs);

      expect(block.number).toEqual(2);

      /*console.log(block);
      console.log(block.encode().toString('hex'));
      console.log(`call data hash   : ${block.getCalldataHash().toString('hex')}`);
      console.log(`start state hash: ${block.getStartStateHash().toString('hex')}`);
      console.log(`end state hash  : ${block.getEndStateHash().toString('hex')}`);
      console.log(`public input hash: ${block.getPublicInputsHash().toString()}`);*/
    }, 10000);

    it('Build blocks on top of blocks l2 block with 4 txs', async () => {
      for (let i = 0; i < 2; i++) {
        const tx = await makeProcessedTx(
          Tx.createPrivate(makeKernelPublicInputs(1 + i), emptyProof, makeEmptyUnverifiedData()),
        );
        const txsLeft = [tx, await makeEmptyProcessedTx()];
        const txsRight = [await makeEmptyProcessedTx(), await makeEmptyProcessedTx()];

        // Set tree roots to proper values in the tx
        await setTxHistoricTreeRoots(tx);

        // Calculate what would be the tree roots after the txs from the first base rollup land and update mock circuit output
        await updateExpectedTreesFromTxs(txsLeft);
        baseRollupOutputLeft.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
        baseRollupOutputLeft.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
        baseRollupOutputLeft.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);

        // Same for the two txs on the right
        await updateExpectedTreesFromTxs(txsRight);
        baseRollupOutputRight.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
        baseRollupOutputRight.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
        baseRollupOutputRight.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);

        // And update the root trees now to create proper output to the root rollup circuit
        await updateRootTrees();
        rootRollupOutput.endContractTreeSnapshot = await getTreeSnapshot(MerkleTreeId.CONTRACT_TREE);
        rootRollupOutput.endNullifierTreeSnapshot = await getTreeSnapshot(MerkleTreeId.NULLIFIER_TREE);
        rootRollupOutput.endPrivateDataTreeSnapshot = await getTreeSnapshot(MerkleTreeId.PRIVATE_DATA_TREE);
        rootRollupOutput.endTreeOfHistoricContractTreeRootsSnapshot = await getTreeSnapshot(
          MerkleTreeId.CONTRACT_TREE_ROOTS_TREE,
        );
        rootRollupOutput.endTreeOfHistoricPrivateDataTreeRootsSnapshot = await getTreeSnapshot(
          MerkleTreeId.PRIVATE_DATA_TREE_ROOTS_TREE,
        );

        // Actually build a block!
        const txs = [tx, await makeEmptyProcessedTx(), await makeEmptyProcessedTx(), await makeEmptyProcessedTx()];
        const [block] = await builder.buildL2Block(1 + i, txs);

        // These output values are the same as in Decoder.t.sol tests
        if (i === 0) {
          expect(block.number).toEqual(1);
          expect(block.getCalldataHash()).toEqual(
            Buffer.from('d6a5d2e14edcbd6cf55d88a7296ecd4c24734c5e188de827b815c66ec708ac95', 'hex'),
          );
          expect(block.getStartStateHash()).toEqual(
            Buffer.from('997d827ef06622bb62d3a84c4c1f70bdd4d04bf46a51cb5347e472ae29451e12', 'hex'),
          );
          expect(block.getEndStateHash()).toEqual(
            Buffer.from('bc4951931d71398752b7d0cdb88a4f04c4cebaf8eeef00b75cd913150ac17883', 'hex'),
          );
          expect(block.getPublicInputsHash().toBuffer()).toEqual(
            Buffer.from('163323613ec38b4525decb91da4fe92b858f61b2eef1dd3c736fea35aa76b727', 'hex'),
          );
        } else {
          expect(block.number).toEqual(2);
          expect(block.getCalldataHash()).toEqual(
            Buffer.from('ec22e817324a6c72e71e02d0c93b7efd82200b23d23fd491de1472ce7291ddf9', 'hex'),
          );
          expect(block.getStartStateHash()).toEqual(
            Buffer.from('bc4951931d71398752b7d0cdb88a4f04c4cebaf8eeef00b75cd913150ac17883', 'hex'),
          );
          expect(block.getEndStateHash()).toEqual(
            Buffer.from('587bd65c5653f227b0eb6b394656be7dee92319e27a4bbc52147f1ff57b7566c', 'hex'),
          );
          expect(block.getPublicInputsHash().toBuffer()).toEqual(
            Buffer.from('221146539ac6e2bd6c13564b510a57e13219552337b38ac3d2ea646c238e046c', 'hex'),
          );
        }

        // Printer useful for checking that output match contracts.
        /*console.log(block);
        console.log(block.encode().toString('hex'));
        console.log(`call data hash   : ${block.getCalldataHash().toString('hex')}`);
        console.log(`start state hash: ${block.getStartStateHash().toString('hex')}`);
        console.log(`end state hash  : ${block.getEndStateHash().toString('hex')}`);
        console.log(`public input hash: ${block.getPublicInputsHash().toString()}`);*/
      }
    }, 10000);
  });
});

// Test subject class that exposes internal functions for testing
class TestSubject extends CircuitBlockBuilder {
  public buildBaseRollupInput(tx1: ProcessedTx, tx2: ProcessedTx): Promise<BaseRollupInputs> {
    return super.buildBaseRollupInput(tx1, tx2);
  }

  public updateRootTrees(): Promise<void> {
    return super.updateRootTrees();
  }
}
