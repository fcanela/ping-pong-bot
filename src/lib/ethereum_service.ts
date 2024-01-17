import {
  ethers,
} from 'ethers';
import Bottleneck from 'bottleneck';
import logger from './logger';

import config from './config';

const abi = [{"inputs":[],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[],"name":"Ping","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"txHash","type":"bytes32"}],"name":"Pong","type":"event"},{"inputs":[],"name":"ping","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"pinger","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_txHash","type":"bytes32"}],"name":"pong","outputs":[],"stateMutability":"nonpayable","type":"function"}];

type EthereumServiceOptions = {
  provider?: ethers.Provider
  wallet?: ethers.Wallet
  contract?: ethers.Contract
}

export type SpecificProvider = {
  name: string
  provider: ethers.JsonRpcProvider
  wallet: ethers.Wallet
}

export default class EthereumService {
  public static PING_TOPIC = ethers.id('Ping()');
  public static PONG_TOPIC = ethers.id('Pong(bytes32)');
  public static PONG_SELECTOR = ethers.id('pong(bytes32)').substring(0, 10);
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private interface: ethers.Interface;
  /**
    * Some operations requires handling transactions that may not have been relayed to other
    * nodes yet. Also, getDefaultProvider() doesn't allow (AFAIK) checking the mempool. This
    * array keeps individual JsonRpcProviders to sort those issues.
    */
  private specificProviders: SpecificProvider[] = [];
  private limiter: Bottleneck;
  private feeData: { maxFeePerGas: bigint, maxPriorityFeePerGas: bigint } | null = null;

  constructor(options?: EthereumServiceOptions) {
    this.provider = options?.provider || ethers.getDefaultProvider('goerli', {
      alchemy: config.ALCHEMY_API_KEY,
      ankr: config.ANKR_API_KEY,
      infura: config.INFURA_API_KEY,
      // Disable community-shared API keys
      cloudflare: '-',
      etherscan: '-',
      publicPolygon: '-',
      quicknode: '-',
    });

    this.wallet = options?.wallet || new ethers.Wallet(config.WALLET_PRIVATE_KEY, this.provider);
    this.contract = options?.contract || new ethers.Contract(config.CONTRACT_ADDRESS, abi, this.wallet);
    this.interface = new ethers.Interface(abi);
    this.limiter = new Bottleneck({
      minTime: Math.floor(1000 / config.PROVIDERS_RPS), 
    });
  
    const addProvider = (key: string, name: string, baseUrl: string) => {
      if (!key || key === '-') return;
      this.specificProviders.push({
        name,
        provider: new ethers.JsonRpcProvider(`${baseUrl}${key}`),
        wallet: new ethers.Wallet(config.WALLET_PRIVATE_KEY, this.provider),
      });
    }
    addProvider(config.ALCHEMY_API_KEY, 'alchemy', 'https://eth-goerli.g.alchemy.com/v2/');
    addProvider(config.ANKR_API_KEY, 'ankr', 'https://rpc.ankr.com/eth_goerli/');
    addProvider(config.INFURA_API_KEY, 'infura', 'https://goerli.infura.io/v3/');
  }

  /**
    * Retrieves the latest block number. 
    */
  async getBlockNumber() {
    return this.limiter.schedule(() => this.provider.getBlockNumber());
  }

  /**
    * Return the log of pings in a block range. 
    */
  async getPings(fromBlock: number, toBlock: number): Promise<ethers.Log[]> {
    return this.limiter.schedule(() => this.provider.getLogs({
      topics: [EthereumService.PING_TOPIC],
      address: config.CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
    }));
  }

  /**
    * Return the log of pongs in a block range. 
    */
  async getPongs(
    fromBlock: number,
    toBlock: number,
    address: string = config.CONTRACT_ADDRESS
  ): Promise<ethers.Log[]> {
    return this.limiter.schedule(() => this.provider.getLogs({
      topics: [EthereumService.PONG_TOPIC],
      address,
      fromBlock,
      toBlock,
    }));
  }

  /**
    * Get the account nonce. 
    */
  async getNonce() {
    return this.limiter.schedule(() => this.wallet.getNonce());
  }

  /**
    * Updates the cache for maxFeePerGas and maxPriorityFeePerGas. 
    */
  async refreshFeeData() {
    // @ts-ignore: Goerli has EIP-1559. maxFeePerGas and maxPriorityFeePerGas will be present 
    this.feeData = await this.limiter.schedule(() => this.provider.getFeeData());
  }

  /**
    * Issues a pong for the given ping hash
    */
  async pong(pingHash: string, options?: {
    nonce?: number,
  }) {
    const { nonce } = options || {};

    const resolvedNonce = nonce || await this.wallet.getNonce();
    const response = await this.limiter.schedule(() => this.contract.pong(pingHash, {
      nonce: resolvedNonce,
      maxFeePerGas: this.feeData?.maxFeePerGas!,
      maxPriorityFeePerGas: this.feeData?.maxPriorityFeePerGas!,
    }));

    return {
      pongHash: response.hash,
    };
  }

  /**
    * Returns a transaction
    */
  async getTransaction(hash: string) {
    return this.limiter.schedule(() => this.provider.getTransaction(hash));
  }

  /**
    * Looks for a transaction in the different providers configured as there is
    * a high chance it is in one of the providers mempool
    */
  async searchMempoolTransaction(hash: string): Promise<{
    providerName: string,
    transaction: ethers.TransactionResponse
  } | undefined>{
    const results = await Promise.all(this.specificProviders.map(async ({ provider, name }) => {
      const transaction = await this.limiter.schedule(() => provider.getTransaction(hash));
      if (transaction) return { providerName: name, transaction };
    }));

    return results.find(Boolean);
  }

  /**
    * Calculates the fees required to unstale a transaction. Returns
    * `null` if the transaction fees are already enough.
    */
  calculateTransactionBumpFees(tx: ethers.TransactionResponse): {
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
  } | null {
    if (!this.feeData) throw new Error('No fee data found. Call refreshFeeData() first');

    const txMaxFee = tx.maxFeePerGas!;
    const txMinerFee = tx.maxPriorityFeePerGas!;
    const { 
      maxFeePerGas: currentMaxFee,
      maxPriorityFeePerGas: currentMinerFee,
    } = this.feeData;

    const areFeesEnough = txMaxFee >= currentMaxFee && txMinerFee >= currentMinerFee;
    if (areFeesEnough) return null;

    const maxPriorityFeePerGas =  currentMinerFee > txMinerFee ? currentMinerFee : txMinerFee;

    // ethers providers follow the EIP-1559 recommendations to compute maxFeePerGas,
    // so we can undo the calculations to obtain the base fee.
    // https://github.com/ethers-io/ethers.js/blob/v6/src.ts/providers/abstract-provider.ts#L723
    const baseFee = (currentMaxFee - currentMinerFee) / 2n;

    // Ethers doesn't automatically recompute the maxFeePerGas given a maxPriorityFeePerGas
    // so we need to provide it
    // https://github.com/ethers-io/ethers.js/blob/v6/src.ts/providers/abstract-signer.ts#L143
    const adjustedMaxFee = (baseFee * 2n) + maxPriorityFeePerGas;

    // Replacement maxFeePerGas should be at least a 10% higher
    // This adds that 10% rounding up keeping the bigint type, without passing through Number
    const minReplacement = txMaxFee + (txMaxFee * 10n + 99n) / 100n;

    // New new maxFeePerGas will be the higher of the three
    const bigIntMax = (...numbers: bigint[]) => numbers.reduce((max, num) => num > max ? num : max);
    const maxFeePerGas = bigIntMax(adjustedMaxFee, minReplacement, currentMaxFee);

    return {
      maxFeePerGas,
      maxPriorityFeePerGas
    };
  }

  /**
    * Replaces a transaction with a different set of fees.
    * Note: it is the caller responsability to ensure the fees are valid
    */
  async bumpTransactionFees(staleTx: ethers.TransactionResponse, fees: {
    maxFeePerGas: bigint, maxPriorityFeePerGas: bigint
  }, providerName: string) {
    const providerRecord = (this.specificProviders.find(({ name }) => name === providerName));
    if (!providerRecord) throw new Error(`Provider ${providerName} not found`);

    return this.limiter.schedule(() => providerRecord.wallet.sendTransaction({
      to: staleTx.to,
      from: staleTx.from,
      data: staleTx.data,
      nonce: staleTx.nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    }));
  }

  getWalletAddress() {
    return this.wallet.address;
  }

  /**
    * Checks the mempool of the different providers and returns
    * the pongs issued by the application address
    */
  async getMyMempoolPongs() {
    const myAddress = this.getWalletAddress();
    const myTransactions: {
      pingHash: string
      pingBlock: number
      pongHash: string
      pongNonce: number
    }[] = [];

    const scanMempool = async ({ name, provider }: SpecificProvider) => {
      const limiter = new Bottleneck({
        minTime: Math.floor(1000 / config.PROVIDERS_RPS), 
      });
      const { transactions: txHashes } = await limiter.schedule(() => provider.send("eth_getBlockByNumber", ["pending", false]));
      logger.warn({ provider: name, amount: txHashes.length }, 'provider mempool scan: starting');

      for (const txHash of txHashes) {
        const tx = await limiter.schedule(() => provider.getTransaction(txHash));
        if (!tx) {
          logger.info({ provider: name, txHash }, 'unable to retrieve mempool transaction');
          continue;
        }
        if (
          tx.from !== myAddress ||
          tx.to !== config.CONTRACT_ADDRESS ||
          !tx.data?.startsWith(EthereumService.PONG_SELECTOR)
        ) {
          logger.debug({ provider: name, txHash }, 'mempool transaction discarded: not relevant');
          continue;
        }

        const decoded = this.interface.parseTransaction(tx);
        if (!decoded) {
          // This shouldn't happen. Decoded can only be null if the event does not correspond to an
          // ABI function. 
          logger.warn({ provider, tx }, 'mempool transaction discarded: unable to parse (abi mismatch?)');
          continue;
        };
        const pingHash = decoded.args[0];

        // Requesting the ping transaction is completely optional: it just provides the ping block.
        // I am making this performance trade-off for better monitoring/debugging logs
        const pingTx = await limiter.schedule(() => provider.getTransaction(pingHash));
        if (!pingTx) logger.warn({ provider: name, pongHash: txHash }, 'found a pong in mempool but the ping transaction is not available');

        myTransactions.push({
          pingHash,
          // Added fallback as the pingBlock is only for monitory/debugging
          pingBlock: pingTx?.blockNumber || -1,
          pongHash: txHash,
          pongNonce: tx.nonce,
        });
      }
      logger.warn({ provider: name }, 'provider mempool scan: finished');
    }

    await Promise.all(this.specificProviders.map(scanMempool));

    return myTransactions;
  }
}
