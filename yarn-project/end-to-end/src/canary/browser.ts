/* eslint-disable no-console */
import * as AztecJs from '@aztec/aztec.js';
import { PrivateTokenContractAbi } from '@aztec/noir-contracts/artifacts';

import { Server } from 'http';
import Koa from 'koa';
import serve from 'koa-static';
import path, { dirname } from 'path';
import { Browser, Page, launch } from 'puppeteer';

declare global {
  /**
   * Helper interface to declare aztec.js within browser context.
   */
  interface Window {
    /**
     * The aztec.js library.
     */
    AztecJs: typeof AztecJs;
  }
}

const __filename = AztecJs.fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;

const { SANDBOX_URL } = process.env;

const conditionalDescribe = () => (SANDBOX_URL ? describe : describe.skip);
const privKey = AztecJs.GrumpkinScalar.random();

export const browserTestSuite = (setup: () => Server, pageLogger: AztecJs.DebugLogger) =>
  conditionalDescribe()('e2e_aztec.js_browser', () => {
    const initialBalance = 33n;
    const transferAmount = 3n;

    let contractAddress: AztecJs.AztecAddress;

    let app: Koa;
    let testClient: AztecJs.AztecRPC;
    let server: Server;

    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      server = setup();
      testClient = AztecJs.createAztecRpcClient(SANDBOX_URL!);
      await AztecJs.waitForSandbox(testClient);

      app = new Koa();
      app.use(serve(path.resolve(__dirname, './web')));

      browser = await launch({
        executablePath: process.env.CHROME_BIN,
        headless: 'new',
        args: [
          '--allow-file-access-from-files',
          '--no-sandbox',
          '--headless',
          '--disable-web-security',
          '--disable-features=IsolateOrigins',
          '--disable-site-isolation-trials',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disk-cache-dir=/dev/null',
        ],
      });
      page = await browser.newPage();
      page.on('console', msg => {
        pageLogger(msg.text());
      });
      page.on('pageerror', err => {
        pageLogger.error(err.toString());
      });
      await page.goto(`http://localhost:${PORT}/index.html`);
    }, 120_000);

    afterAll(async () => {
      await browser.close();
      server.close();
    });

    it('Loads Aztec.js in the browser', async () => {
      const generatePublicKeyExists = await page.evaluate(() => {
        const { generatePublicKey } = window.AztecJs;
        return typeof generatePublicKey === 'function';
      });
      expect(generatePublicKeyExists).toBe(true);
    });

    it('Creates an account', async () => {
      const result = await page.evaluate(
        async (rpcUrl, privateKeyString) => {
          const { GrumpkinScalar, createAztecRpcClient, getUnsafeSchnorrAccount } = window.AztecJs;
          const client = createAztecRpcClient(rpcUrl!);
          const privateKey = GrumpkinScalar.fromString(privateKeyString);
          const account = getUnsafeSchnorrAccount(client, privateKey);
          await account.waitDeploy();
          const completeAddress = await account.getCompleteAddress();
          const addressString = completeAddress.address.toString();
          console.log(`Created Account: ${addressString}`);
          return addressString;
        },
        SANDBOX_URL,
        privKey.toString(),
      );
      const accounts = await testClient.getRegisteredAccounts();
      const stringAccounts = accounts.map(acc => acc.address.toString());
      expect(stringAccounts.includes(result)).toBeTruthy();
    }, 15_000);

    it('Deploys Private Token contract', async () => {
      await deployPrivateTokenContract();
    }, 30_000);

    it("Gets the owner's balance", async () => {
      const result = await page.evaluate(
        async (rpcUrl, contractAddress, PrivateTokenContractAbi) => {
          const { Contract, AztecAddress, createAztecRpcClient } = window.AztecJs;
          const client = createAztecRpcClient(rpcUrl!);
          const owner = (await client.getRegisteredAccounts())[0].address;
          const [wallet] = await AztecJs.getSandboxAccountsWallets(client);
          const contract = await Contract.at(AztecAddress.fromString(contractAddress), PrivateTokenContractAbi, wallet);
          const balance = await contract.methods.getBalance(owner).view({ from: owner });
          console.log(`Owner's balance: ${balance}`);
          return balance;
        },
        SANDBOX_URL,
        (await getPrivateTokenAddress()).toString(),
        PrivateTokenContractAbi,
      );
      expect(result).toEqual(initialBalance);
    });

    it('Sends a transfer TX', async () => {
      const result = await page.evaluate(
        async (rpcUrl, contractAddress, transferAmount, PrivateTokenContractAbi) => {
          console.log(`Starting transfer tx`);
          const { AztecAddress, Contract, createAztecRpcClient } = window.AztecJs;
          const client = createAztecRpcClient(rpcUrl!);
          const accounts = await client.getRegisteredAccounts();
          const owner = accounts[0].address;
          const receiver = accounts[1].address;
          const [wallet] = await AztecJs.getSandboxAccountsWallets(client);
          const contract = await Contract.at(AztecAddress.fromString(contractAddress), PrivateTokenContractAbi, wallet);
          await contract.methods.transfer(transferAmount, receiver).send().wait();
          console.log(`Transferred ${transferAmount} tokens to new Account`);
          const receiverBalance = await contract.methods.getBalance(receiver).view({ from: receiver });
          console.log(`Receiver's balance is now: ${receiverBalance}`);
          const senderBalance = await contract.methods.getBalance(owner).view({ from: owner });
          console.log(`Updated sender balance: ${senderBalance}`);
          return receiverBalance;
        },
        SANDBOX_URL,
        (await getPrivateTokenAddress()).toString(),
        transferAmount,
        PrivateTokenContractAbi,
      );
      expect(result).toEqual(transferAmount);
    }, 60_000);

    const deployPrivateTokenContract = async () => {
      const txHash = await page.evaluate(
        async (rpcUrl, privateKeyString, initialBalance, PrivateTokenContractAbi) => {
          const { GrumpkinScalar, DeployMethod, createAztecRpcClient, getUnsafeSchnorrAccount } = window.AztecJs;
          const client = createAztecRpcClient(rpcUrl!);
          let accounts = await client.getRegisteredAccounts();
          if (accounts.length === 0) {
            // This test needs an account for deployment. We create one in case there is none available in the RPC server.
            const privateKey = GrumpkinScalar.fromString(privateKeyString);
            await getUnsafeSchnorrAccount(client, privateKey).waitDeploy();
            accounts = await client.getRegisteredAccounts();
          }
          const owner = accounts[0];
          const tx = new DeployMethod(owner.publicKey, client, PrivateTokenContractAbi, [
            initialBalance,
            owner.address,
          ]).send();
          await tx.wait();
          const receipt = await tx.getReceipt();
          console.log(`Contract Deployed: ${receipt.contractAddress}`);
          return receipt.txHash.toString();
        },
        SANDBOX_URL,
        privKey.toString(),
        initialBalance,
        PrivateTokenContractAbi,
      );

      const txResult = await testClient.getTxReceipt(AztecJs.TxHash.fromString(txHash));
      expect(txResult.status).toEqual(AztecJs.TxStatus.MINED);
      contractAddress = txResult.contractAddress!;
    };

    const getPrivateTokenAddress = async () => {
      if (!contractAddress) {
        await deployPrivateTokenContract();
      }
      return contractAddress;
    };
  });