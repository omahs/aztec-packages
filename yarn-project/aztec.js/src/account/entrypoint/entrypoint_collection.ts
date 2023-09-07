import { AztecAddress, Fr } from '@aztec/circuits.js';
import { FunctionCall, TxExecutionRequest } from '@aztec/types';

import { Account } from '../account.js';
import { CreateTxRequestOpts, Entrypoint, IAuthWitnessAccountEntrypoint } from './index.js';

/**
 * An entrypoint that groups together multiple concrete entrypoints.
 * Delegates to the registered entrypoints based on the requested origin.
 */
export class EntrypointCollection implements Entrypoint {
  private entrypoints: Map<string, Entrypoint> = new Map();

  constructor(entrypoints: [AztecAddress, Entrypoint][] = []) {
    for (const [key, value] of entrypoints) {
      this.registerAccount(key, value);
    }
  }

  /**
   * Creates a new instance out of a set of Accounts.
   * @param accounts - Accounts to register in this entrypoint.
   * @returns A new instance.
   */
  static async fromAccounts(accounts: Account[]) {
    const collection = new EntrypointCollection();
    for (const account of accounts) {
      collection.registerAccount((await account.getCompleteAddress()).address, await account.getEntrypoint());
    }
    return collection;
  }

  /**
   * Registers an entrypoint against an aztec address
   * @param addr - The aztec address against which to register the implementation.
   * @param impl - The entrypoint to be registered.
   */
  public registerAccount(addr: AztecAddress, impl: Entrypoint) {
    this.entrypoints.set(addr.toString(), impl);
  }

  public createTxExecutionRequest(
    executions: FunctionCall[],
    opts: CreateTxRequestOpts = {},
  ): Promise<TxExecutionRequest> {
    const defaultAccount = this.entrypoints.values().next().value as Entrypoint;
    const impl = opts.origin ? this.entrypoints.get(opts.origin.toString()) : defaultAccount;
    if (!impl) throw new Error(`No entrypoint registered for ${opts.origin}`);
    return impl.createTxExecutionRequest(executions, opts);
  }
}

/**
 * An entrypoint that groups together multiple Auth Witness entrypoints.
 * Delegates to the registered entrypoints based on the requested origin.
 */
export class AuthEntrypointCollection implements IAuthWitnessAccountEntrypoint {
  private entrypoints: Map<string, IAuthWitnessAccountEntrypoint> = new Map();

  constructor(entrypoints: [AztecAddress, IAuthWitnessAccountEntrypoint][] = []) {
    for (const [key, value] of entrypoints) {
      this.registerAccount(key, value);
    }
  }
  /**
   * Creates a new instance out of a set of Accounts.
   * @param accounts - Accounts to register in this entrypoint.
   * @returns A new instance.
   */
  static async fromAccounts(accounts: Account[]) {
    const collection = new AuthEntrypointCollection();
    for (const account of accounts) {
      collection.registerAccount(
        (await account.getCompleteAddress()).address,
        (await account.getEntrypoint()) as IAuthWitnessAccountEntrypoint,
      );
    }
    return collection;
  }

  /**
   * Registers an entrypoint against an aztec address
   * @param addr - The aztec address against which to register the implementation.
   * @param impl - The entrypoint to be registered.
   */
  public registerAccount(addr: AztecAddress, impl: IAuthWitnessAccountEntrypoint) {
    this.entrypoints.set(addr.toString(), impl);
  }

  public sign(message: Buffer, opts: CreateTxRequestOpts = {}): Buffer {
    const defaultAccount = this.entrypoints.values().next().value as IAuthWitnessAccountEntrypoint;
    const impl = opts.origin ? this.entrypoints.get(opts.origin.toString()) : defaultAccount;
    if (!impl) throw new Error(`No entrypoint registered for ${opts.origin}`);
    return impl.sign(message);
  }
  createAuthWitness(message: Buffer, opts: CreateTxRequestOpts = {}): Promise<Fr[]> {
    const defaultAccount = this.entrypoints.values().next().value as IAuthWitnessAccountEntrypoint;
    const impl = opts.origin ? this.entrypoints.get(opts.origin.toString()) : defaultAccount;
    if (!impl) throw new Error(`No entrypoint registered for ${opts.origin}`);
    return impl.createAuthWitness(message);
  }

  createTxExecutionRequest(_executions: FunctionCall[], _opts?: CreateTxRequestOpts): Promise<TxExecutionRequest> {
    throw new Error('Method not implemented.');
  }

  async createTxExecutionRequestWithWitness(
    executions: FunctionCall[],
    opts: CreateTxRequestOpts = {},
  ): Promise<{
    /** The transaction request */
    txRequest: TxExecutionRequest;
    /** The auth witness */
    witness: Fr[];
    /** The message signed */
    message: Buffer;
  }> {
    const defaultAccount = this.entrypoints.values().next().value as IAuthWitnessAccountEntrypoint;
    const impl = opts.origin ? this.entrypoints.get(opts.origin.toString()) : defaultAccount;
    if (!impl) throw new Error(`No entrypoint registered for ${opts.origin}`);
    return await impl.createTxExecutionRequestWithWitness(executions, opts);
  }
}
