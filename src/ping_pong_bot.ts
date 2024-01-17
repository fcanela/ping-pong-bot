import type Logger from './lib/logger';
import config from './lib/config';
import type { Storage } from './lib/storage';
import EthereumService from './lib/ethereum_service';
import {
  IterationType,
  IterationState,
  type Iteration,
  type RecoveryIteration,
} from './types';

/**
  * Orchestrates the logic to periodically read pings and issue pongs, while
  * avoiding duplicates or missing pongs
  */
export default class PingPong {
  private client: EthereumService;
  private storage: Storage;
  private logger: typeof Logger;

  // setTimeout that controls when to iterate again
  public nextIteration?: NodeJS.Timeout;
  // Defined only when the process is exiting
  private onReadyToClose?: Function

  constructor(client: EthereumService, storage: Storage, logger: typeof Logger) {
    this.client = client;
    this.storage = storage;
    this.logger = logger;
  }

  /**
    * Starts and keeps processing the ping-pong interactions until the `stop`
    * method is called
    */
  async start() {
    this.nextIteration = undefined;
    await this.iterate();

    // If the bot process is gracefully exiting, do not iterate again
    if (this.onReadyToClose) {
      this.onReadyToClose();
      return;
    }

    // Schedules another iteration
    this.nextIteration = setTimeout(
      this.start.bind(this),
      config.COOLDOWN_PERIOD_MINUTES * 60_000
    );
  }

  /**
    * Ensures no more iterations are run after finishing the current one
    */
  stop() {
    return new Promise((resolve) => this.onReadyToClose = resolve);
  }

  /**
    * Checks which steps are required to be done in the current iteration
    * and executes them
    */
  private async iterate() {
    const { storage, logger } = this;

    const previousIteration = await storage.getIteration();
    const iteration = await this.planIteration(previousIteration);

    if (!iteration) {
      logger.info(iteration, 'not enough blocks mined yet, skipping');
      return;
    }

    logger.info(iteration, 'iteration started');

    await storage.setIteration(iteration);

    switch (iteration.type) {
      case IterationType.RECOVERY_START:
        logger.warn(iteration, 'starting recovery mode');
        logger.info('checking mempool for missing pongs in storage (be patient, this could take a while)');
        await this.processMempool();
        break;

      case IterationType.RECOVERY_END:
        logger.info('issuing pongs for pending exchanges (be patient, this could take a while)');
        await this.answerPendingPings();
        logger.warn(iteration, 'recovery completed');
        break;

      case IterationType.NORMAL:
      case IterationType.RECOVERY:
        const { fromBlock, toBlock } = iteration;
        const isRecoveryModeEnabled = iteration.type === IterationType.RECOVERY;

        logger.info('checking for issued pongs');
        await this.processPongs(iteration.fromBlock, toBlock, isRecoveryModeEnabled);

        logger.info('checking for new pings');
        await this.processPings(fromBlock, toBlock);

        logger.info('cleaning up the registry from completed interactions');
        await this.cleanup();

        if (!isRecoveryModeEnabled) {
          logger.info('checking if there are pings without issued pong');
          await this.answerPendingPings();

          logger.info('checking for stale pong responses');
          await this.processStalePongs();
        }

        break;
    }

    logger.info(iteration, 'iteration completed');
    await storage.setIteration({ ...iteration, state: IterationState.COMPLETED });
  }

  /**
    * Returns an object with the instructions for the next iteration, taking in
    * account the previous one
    */
  private async planIteration(previous?: Iteration): Promise<Iteration|null> {
    if (!previous) {
      return {
        type: IterationType.RECOVERY_START,
        state: IterationState.STARTED,
        toBlock: config.STARTING_BLOCK - 1,
      };
    }

    // Previous iteration failed
    if (previous.state === IterationState.STARTED) {
      return {
        type: IterationType.RECOVERY_START,
        state: IterationState.STARTED,
        // If the aborted iteration was a NORMAL or RECOVERY start, the latest succesfully
        // processed block is the one before `fromBlock`.
        toBlock: 'fromBlock' in previous? previous.fromBlock - 1 : previous.toBlock,
      };
    }

    // Safe block reached, end of recovery
    if (previous.type === IterationType.RECOVERY && previous.toBlock >= previous.recoveryUntilBlock) {
      return {
        type: IterationType.RECOVERY_END,
        state: IterationState.STARTED,
        toBlock: previous.toBlock,
      };
    }

    const currentBlock = await this.client.getBlockNumber();
    const currentConfirmedBlock = currentBlock - config.CONFIRMATION_BLOCKS;
    const fromBlock = previous.toBlock + 1;
    const toBlock = Math.min(currentConfirmedBlock, fromBlock + config.MAX_BLOCKS_BATCH_SIZE);
    // Not enough blocks
    if (toBlock - fromBlock < 1) return null;

    if (previous.type === IterationType.RECOVERY || previous.type === IterationType.RECOVERY_START) {
      const next: RecoveryIteration = {
        type: IterationType.RECOVERY,
        state: IterationState.STARTED,
        fromBlock,
        toBlock,
        recoveryUntilBlock: 'recoveryUntilBlock' in previous ? previous.recoveryUntilBlock : currentBlock,
      }
      return next;
    }

    return {
      type: IterationType.NORMAL,
      state: IterationState.STARTED,
      fromBlock,
      toBlock,
    };
  }

  /**
    * Reads a block range and records all the pongs issued by the application to confirm them.
    */
  private async processPongs (fromBlock: number, toBlock: number, isRecoveryModeEnabled: boolean) {
    const { client, storage, logger } = this;
    const pongs = await client.getPongs(fromBlock, toBlock);

    if (pongs.length === 0) return;

    const myAddress = client.getWalletAddress();

    for (const pong of pongs) {
      const {
        transactionHash: pongHash,
        blockNumber: pongBlock,
        data: pingHash,
      } = pong;

      logger.info({ pingHash, pongHash, pongBlock }, 'pong detected');

      let exchange = await storage.getExchange(pingHash);

      // In recovery mode we do not trust the storage content (example: it may be an outdated backup)
      if (isRecoveryModeEnabled) {
        const tx = await client.getTransaction(pongHash);
        // This shouldn't happen, but providers can have isssues
        if (tx === null) throw new Error(`Unable to retrieve the transaction for pong ${pongHash}`);

        if (tx.from !== myAddress) {
          logger.debug({ pingHash, pongHash, pongBlock, from: tx.from }, 'pong ignored: not mine');
          continue;
        }

        exchange = await storage.putCompletedExchange({
          ...exchange || {},
          pingHash,
          pongHash,
          pongBlock,
          pongNonce: tx.nonce,
        });
        logger.info({ pingHash, pongHash, pongBlock }, 'pong verified: exchange completed (safe iteration)');
        continue;
      }

      if (!exchange || exchange.state !== 'pong_issued' || exchange.pongHash !== pongHash) {
        // If it is safe to assume we didn't issued it, ignore it: it must be other contract user
        logger.debug({ pingHash, pongHash, pongBlock }, 'pong ignored: probably not mine');
        continue;
      }

      // Marking it as done instead of deleting to ensure we do not double detect pings on error conditions
      exchange = await storage.putCompletedExchange({ ...exchange, pongBlock });
      logger.info(exchange, 'pong verified: exchange completed');
    }
  };

  /**
    * Reads a block range and records all the new pings found
    */
  private async processPings(fromBlock: number, toBlock: number) {
    const { client, storage, logger } = this;

    const pings = await client.getPings(fromBlock, toBlock);
    if (pings.length === 0) return;

    for (const ping of pings) {
      const {
        blockNumber: pingBlock,
        transactionHash: pingHash,
      } = ping;
      logger.info({ pingHash, pingBlock }, 'ping detected');

      let exchange = await storage.getExchange(pingHash);
      if (exchange) {
        logger.info({ pingHash, pingBlock }, 'ping ignored: already processed');
        continue;
      }

      logger.info({ pingHash, pingBlock }, 'ping stored to be processed later');
      exchange = await storage.putPingDetected({ pingHash, pingBlock }); 
    }
  };

  /**
    * Removes completed exchanges from storage
    */
  private async cleanup() {
    const { storage, logger } = this;
    const removed = await storage.removeCompletedExchanges();
    if (removed.length > 0) logger.info({ amount: removed.length }, 'completed exchanges deleted');
  }

  /**
    * Issues a pong for every ping in "detected" state
    */
  private async answerPendingPings() {
    const { client, storage, logger } = this;

    const exchanges = await storage.getPingDetectedExchanges();
    if (exchanges.length === 0) return;

    let nonce = await client.getNonce();

    for (let exchange of exchanges) {
      logger.info(exchange, 'found ping without issued pong');
      const { pingHash } = exchange;
      const pong = await client.pong(pingHash, { nonce });
      const updatedExchange = await storage.putPongIssued({
        ...exchange,
        pongHash: pong.pongHash,
        pongNonce: nonce,
      });
      logger.info(updatedExchange, 'pong issued');
      nonce += 1;
    }
  }

  /**
    * Checks the state of pongs that has not been confirmed yet. If the fees are not
    * enough, it provides more. If the transaction has been dropped from mempool it is
    * reissued
    */
  private async processStalePongs() {
    const { client, storage, logger } = this;

    const staleExchanges = await storage.getStalePongIssuedExchanges();
    if (staleExchanges.length === 0) return;
    logger.info(`found ${staleExchanges.length} stale pongs`);

    await client.refreshFeeData();

    for (const exchange of staleExchanges) {
      const { pingHash, pongHash } = exchange;
      logger.debug(exchange, 'processing stale exchange');

      const searchResult = await client.searchMempoolTransaction(pongHash);
      if (!searchResult) {
        logger.warn(exchange, 'pong transaction not found');
        const { pongHash } = await client.pong(pingHash);

        const updatedExchange = await storage.putPongIssued({
          ...exchange,
          pongHash,
          pongTimestamp: new Date().toISOString(),
        });
        logger.warn(updatedExchange, 'pong reissued');
        continue;
      }

      const {
        transaction: staleTx,
        providerName,
      } = searchResult;

      const { blockNumber } = staleTx;
      if (blockNumber) {
        logger.debug(exchange, 'stale pong sucessfully mined but we are doing nothing yet (just keeping track until confirmed)');
        continue;
      }

      const newFees = client.calculateTransactionBumpFees(staleTx);

      if (!newFees) {
        logger.warn(exchange, 'the stale transaction fee should be enough');
        continue;
      }

      logger.warn(exchange, 'found stale pong with low fees');
      await client.bumpTransactionFees(staleTx, newFees, providerName);
      // This updates the pongTimestamp and avoids early reprocessing
      await storage.putPongIssued({
        ...exchange,
        pongTimestamp: new Date().toISOString(),
      })
      logger.info(exchange, 'stale transaction replaced with higher fees');
    }
  }

  /**
    * Scans every provider mempool to retrieve pongs that are missing from local
    * storage
    */
  private async processMempool() {
    const { client, storage, logger } = this;

    const pongs = await client.getMyMempoolPongs();
    if (pongs.length === 0) return;

    logger.warn({ amount: pongs.length }, 'found pongs in mempool');

    // I am aware that this is not the most performant solution: LevelDB has a batch
    // function which I could use to write all the items at one, without multiple awaits.
    // This works well enough though, provides detailed logs and the code section is rarely
    // executed, so I will skip the refactor
    for (const pong of pongs) {
      const exchange = await storage.putPongIssued(pong);
      logger.warn(exchange, 'recovered pong from mempool');
    }
  }
}
