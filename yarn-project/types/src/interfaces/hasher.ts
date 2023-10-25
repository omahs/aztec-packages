/**
 * Defines hasher interface used by Merkle trees.
 */
export interface Hasher {
  /**
   * Hashes two 32-byte hashes.
   * @param lhs - The first 32-byte array.
   * @param rhs - The second 32-byte array.
   * @returns The new 32-byte hash.
   */
  hash(lhs: Uint8Array, rhs: Uint8Array): Buffer;

  /**
   * Hashes an array of buffers.
   * @param inputs - The array of buffers to hash.
   * @returns The resulting 32-byte hash.
   */
  hashInputs(inputs: Buffer[]): Buffer;

  /**
   * Get a 32-byte hash from a buffer.
   * @param data - The data buffer.
   * @returns The resulting hash buffer.
   */
  hashToField(data: Uint8Array): Buffer;

  /**
   * Given a buffer containing 32 byte leaves, return a new buffer containing the leaves and all pairs of
   * nodes that define a merkle tree.
   *
   * E.g.
   * Input:  [1][2][3][4]
   * Output: [1][2][3][4][hash(1,2)][hash(3,4)][hash(5,6)].
   *
   * @param leaves - The 32 byte leaves.
   * @returns A tree represented by an array.
   */
  hashToTree(leaves: Buffer[]): Promise<Buffer[]>;
}
