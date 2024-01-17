import PingPongBot from './ping_pong_bot';
import EthereumService from './lib/ethereum_service';
import logger from './lib/logger';
import {
  Storage,
} from './lib/storage';
import config from './lib/config';
import {
  IterationState,
  IterationType,
  type PongIssuedExchange,
  type Iteration,
} from './types';
import {
  generateRandomHash,
  generateRandomAddress,
  mockFeeData,
} from './lib/test_utils';
import type {
  TransactionResponse,
  Log,
} from 'ethers';

jest.mock('./lib/ethereum_service');
jest.mock('./lib/logger');

describe('PingPongBot', () => {
  let bot: PingPongBot;

  let storage: Storage;
  let mockClient: jest.MockedObjectDeep<EthereumService>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    storage = new Storage({ inMemory: true });
    mockClient = new EthereumService() as jest.MockedObjectDeep<EthereumService>;
    mockLogger = logger as typeof mockLogger;

    bot = new PingPongBot(mockClient, storage, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('start', () => {
    beforeEach(() => {
      bot['iterate'] = jest.fn();
    });

    afterEach(() => {
      clearTimeout(bot.nextIteration);
    });

    it('should do a iteration round', async () => {
      await bot.start();
      expect(bot['iterate']).toHaveBeenCalledTimes(1);
    });

    it('should schedule another iteration when it is not under graceful shutdown', async () => {
      await bot.start();
      expect(bot.nextIteration).toBeDefined();
    });

    it('should not schedule another iteration when it is not under graceful shutdown', async () => {
      bot['onReadyToClose'] = jest.fn();

      await bot.start();
      expect(bot.nextIteration).toBeUndefined();
      expect(bot['onReadyToClose']).toHaveBeenCalledTimes(1);
    });
  });

  describe('iterate', () => {
    const mockIteration: Iteration = {
      type: IterationType.NORMAL,
      state: IterationState.STARTED,
      fromBlock: 20,
      toBlock: 30,
    };

    let mockPlanIterationFn: jest.Mock;
    beforeEach(async () => {
      bot['planIteration'] = mockPlanIterationFn = jest.fn().mockResolvedValueOnce(mockIteration);

      bot['processPings'] = jest.fn();
      bot['processPongs'] = jest.fn();
      bot['cleanup'] = jest.fn();
      bot['processStalePongs'] = jest.fn();
      bot['processMempool'] = jest.fn();
      bot['answerPendingPings'] = jest.fn();
    });

    it('should call "planIteration" to plan the iteration', async () => {
      await bot['iterate']();

      expect(bot['planIteration']).toHaveBeenCalledTimes(1);
    });

    it('should skip the iteration when it receives no iteration (not enough confirmed blocks)', async () => {
      mockPlanIterationFn.mockReset().mockReturnValueOnce(null);

      await bot['iterate']();
      expect(bot['processPings']).toHaveBeenCalledTimes(0);
      expect(bot['processPongs']).toHaveBeenCalledTimes(0);
      expect(bot['processStalePongs']).toHaveBeenCalledTimes(0);
      expect(bot['cleanup']).toHaveBeenCalledTimes(0);
      expect(bot['processMempool']).toHaveBeenCalledTimes(0);
      expect(bot['answerPendingPings']).toHaveBeenCalledTimes(0);
    });

    it('should call the steps for NORMAL iterations', async () => {
      const iteration: Iteration = {
        type: IterationType.NORMAL,
        state: IterationState.STARTED,
        fromBlock: 5,
        toBlock: 10,
      };
      mockPlanIterationFn.mockReset().mockReturnValueOnce(iteration);

      await bot['iterate']();
      expect(bot['processPings']).toHaveBeenCalledTimes(1);
      expect(bot['processPings']).toHaveBeenCalledWith(iteration.fromBlock, iteration.toBlock);
      expect(bot['processPongs']).toHaveBeenCalledTimes(1);
      expect(bot['processPongs']).toHaveBeenCalledWith(iteration.fromBlock, iteration.toBlock, false);
      expect(bot['answerPendingPings']).toHaveBeenCalledTimes(1);
      expect(bot['processStalePongs']).toHaveBeenCalledTimes(1);
      expect(bot['cleanup']).toHaveBeenCalledTimes(1);
      expect(bot['processMempool']).toHaveBeenCalledTimes(0);
    });

    it('should call the steps for RECOVERY_START iterations', async () => {
      const iteration: Iteration = {
        type: IterationType.RECOVERY_START,
        state: IterationState.STARTED,
        toBlock: 10,
      };
      mockPlanIterationFn.mockReset().mockReturnValueOnce(iteration);

      await bot['iterate']();
      expect(bot['processMempool']).toHaveBeenCalledTimes(1);
      expect(bot['processPings']).toHaveBeenCalledTimes(0);
      expect(bot['processPongs']).toHaveBeenCalledTimes(0);
      expect(bot['processStalePongs']).toHaveBeenCalledTimes(0);
      expect(bot['cleanup']).toHaveBeenCalledTimes(0);
      expect(bot['answerPendingPings']).toHaveBeenCalledTimes(0);
    });

    it('should call the steps for RECOVERY iterations', async () => {
      const iteration: Iteration = {
        type: IterationType.RECOVERY,
        state: IterationState.STARTED,
        fromBlock: 5,
        toBlock: 10,
        recoveryUntilBlock: 10,
      };
      mockPlanIterationFn.mockReset().mockReturnValueOnce(iteration);

      await bot['iterate']();
      expect(bot['processPings']).toHaveBeenCalledTimes(1);
      expect(bot['processPings']).toHaveBeenCalledWith(iteration.fromBlock, iteration.toBlock);
      expect(bot['processPongs']).toHaveBeenCalledTimes(1);
      expect(bot['processPongs']).toHaveBeenCalledWith(iteration.fromBlock, iteration.toBlock, true);
      expect(bot['cleanup']).toHaveBeenCalledTimes(1);
      expect(bot['processStalePongs']).toHaveBeenCalledTimes(0);
      expect(bot['processMempool']).toHaveBeenCalledTimes(0);
      expect(bot['answerPendingPings']).toHaveBeenCalledTimes(0);
    });

    it('should call the steps for RECOVERY_END iterations', async () => {
      const iteration: Iteration = {
        type: IterationType.RECOVERY_END,
        state: IterationState.STARTED,
        toBlock: 10,
      };
      mockPlanIterationFn.mockReset().mockReturnValueOnce(iteration);

      await bot['iterate']();
      expect(bot['answerPendingPings']).toHaveBeenCalledTimes(1);
      expect(bot['processPings']).toHaveBeenCalledTimes(0);
      expect(bot['processPongs']).toHaveBeenCalledTimes(0);
      expect(bot['processStalePongs']).toHaveBeenCalledTimes(0);
      expect(bot['cleanup']).toHaveBeenCalledTimes(0);
      expect(bot['processMempool']).toHaveBeenCalledTimes(0);
    });
  });

  describe('planIteration', () => {
    const mockCurrentBlock = 200;
    const mockCurrentConfirmedBlock = 200 - config.CONFIRMATION_BLOCKS;
    beforeEach(() => {
      mockClient.getBlockNumber.mockResolvedValueOnce(mockCurrentBlock);
    });

    describe('when the bot is started for the first time (or the local data is lost)', () => {
      it('should trigger RECOVERY_START, marking the latest safe block as the one before config.STARTING_BLOCK', async () => {
        const previous = undefined;

        const next = await bot['planIteration'](previous);
        expect(next).toMatchObject({
          type: IterationType.RECOVERY_START,
          state: IterationState.STARTED,
          toBlock: config.STARTING_BLOCK - 1,
        });
      });
    });

    describe('when the previous iteration was not marked as complete', () => {
      it('should trigger RECOVERY_START from the previous iteration block range start', async () => {
        const previous: Iteration = {
          type: IterationType.NORMAL,
          state: IterationState.STARTED,
          fromBlock: 5,
          toBlock: 10,
        };

        const next = await bot['planIteration'](previous);
        expect(next).toMatchObject({
          type: IterationType.RECOVERY_START,
          state: IterationState.STARTED,
          toBlock: previous.fromBlock - 1,
        });
      });
    });

    describe('when the previous iteration was a RECOVERY_START one', () => {
      it('should transition into RECOVERY mode', async () => {
        const previous: Iteration = {
          type: IterationType.RECOVERY_START,
          state: IterationState.COMPLETED,
          toBlock: 5,
        };

        const next = await bot['planIteration'](previous);
        expect(next).toMatchObject({
          type: IterationType.RECOVERY,
          state: IterationState.STARTED,
          fromBlock: previous.toBlock + 1,
          toBlock: mockCurrentConfirmedBlock,
          recoveryUntilBlock: mockCurrentBlock,
        });
      });
    });

    describe('when the previous iteration was a RECOVERY_END one', () => {
      it('should transition into NORMAL iterations', async () => {
        const previous: Iteration = {
          type: IterationType.RECOVERY_END,
          state: IterationState.COMPLETED,
          toBlock: 5,
        };

        const next = await bot['planIteration'](previous);
        expect(next).toMatchObject({
          type: IterationType.NORMAL,
          state: IterationState.STARTED,
          fromBlock: previous.toBlock + 1,
          toBlock: mockCurrentConfirmedBlock,
        });
      });
    });

    describe('when the previous iteration was a NORMAL one', () => {
      describe('if there are pending blocks', () => {
        it('should perform another NORMAL iteration', async () => {
          const previous: Iteration = {
            type: IterationType.NORMAL,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
          };

          const next = await bot['planIteration'](previous);
          expect(next).toMatchObject({
            type: IterationType.NORMAL,
            state: IterationState.STARTED,
            fromBlock: previous.toBlock + 1,
            toBlock: mockCurrentConfirmedBlock,
          });
        });

        it('should not process more than the max blocks per iteration', async () => {
          const previous: Iteration = {
            type: IterationType.NORMAL,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
          };
          mockClient.getBlockNumber.mockReset().mockResolvedValueOnce(previous.toBlock + config.MAX_BLOCKS_BATCH_SIZE * 2);

          const next = await bot['planIteration'](previous);
          expect(next).toMatchObject({
            type: IterationType.NORMAL,
            state: IterationState.STARTED,
            fromBlock: previous.toBlock + 1,
            toBlock: previous.toBlock + 1 + config.MAX_BLOCKS_BATCH_SIZE,
          });
        });
      });

      describe('if there are no more confirmed blocks', () => {
        it('should return no iteration, so we can skip that one', async () => {
          const previous: Iteration = {
            type: IterationType.NORMAL,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
          };
          mockClient.getBlockNumber.mockReset().mockResolvedValueOnce(previous.toBlock);

          const next = await bot['planIteration'](previous);
          expect(next).toBeNull;
        });
      });
    });

    describe('when the previous iteration was a RECOVERY one', () => {
      describe('the safe block is still not processed and there are confirmed blocks pending', () => {
        it('should perform another RECOVERY iteration', async () => {
          const previous: Iteration = {
            type: IterationType.RECOVERY,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
            recoveryUntilBlock: mockCurrentBlock, 
          };

          const next = await bot['planIteration'](previous);
          expect(next).toMatchObject({
            type: IterationType.RECOVERY,
            state: IterationState.STARTED,
            fromBlock: previous.toBlock + 1,
            toBlock: mockCurrentConfirmedBlock,
            recoveryUntilBlock: mockCurrentBlock, 
          });
        });

        it('should not process more than the max blocks per iteration', async () => {
          const previous: Iteration = {
            type: IterationType.RECOVERY,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
            recoveryUntilBlock: mockCurrentBlock,
          };
          mockClient.getBlockNumber.mockReset().mockResolvedValueOnce(
            previous.toBlock + config.MAX_BLOCKS_BATCH_SIZE * 2
          );

          const next = await bot['planIteration'](previous);
          expect(next).toMatchObject({
            type: IterationType.RECOVERY,
            state: IterationState.STARTED,
            fromBlock: previous.toBlock + 1,
            toBlock: previous.toBlock + 1 + config.MAX_BLOCKS_BATCH_SIZE,
          });
        });
      });

      describe('the end-of-recovery block is still not processed but there are NO confirmed blocks pending', () => {
        it('should return no iteration, so we can skip that one', async () => {
          const previous: Iteration = {
            type: IterationType.RECOVERY,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
            recoveryUntilBlock: 200, 
          };
          mockClient.getBlockNumber.mockReset().mockResolvedValueOnce(previous.toBlock);

          const next = await bot['planIteration'](previous);
          expect(next).toBeNull();
        });
      });

      describe('the end-of-recovery block has been already processed', () => {
        it('should trigger a RECOVERY_END', async () => {
          const previous: Iteration = {
            type: IterationType.RECOVERY,
            state: IterationState.COMPLETED,
            fromBlock: 5,
            toBlock: 10,
            recoveryUntilBlock: 8,
          };

          const next = await bot['planIteration'](previous);
          expect(next).toMatchObject({
            type: IterationType.RECOVERY_END,
            state: IterationState.STARTED,
            toBlock: previous.toBlock,
          });
        });
      });
    });

    it('should correctly handle blocks continuity during the first start', async () => {
      let currentBlock = config.STARTING_BLOCK + config.CONFIRMATION_BLOCKS;
      let currentConfirmedBlock = currentBlock - config.CONFIRMATION_BLOCKS;

      const bumpCurrentBlock = () => {
        currentBlock += config.CONFIRMATION_BLOCKS;
        currentConfirmedBlock += config.CONFIRMATION_BLOCKS;
        mockClient.getBlockNumber.mockReset().mockResolvedValue(currentBlock);
      }

      bumpCurrentBlock();

      // Bot starts, enters recovery mode
      let iteration = await bot['planIteration']();
      expect(iteration).toMatchObject({
        type: IterationType.RECOVERY_START,
        state: IterationState.STARTED,
        toBlock: config.STARTING_BLOCK - 1,
      });
      let previous: Iteration = iteration!;
      previous.state = IterationState.COMPLETED;

      bumpCurrentBlock();

      // Bot starts, processes the first batch of blocks in recovery
      iteration = await bot['planIteration'](previous);
      expect(iteration).toMatchObject({
        type: IterationType.RECOVERY,
        state: IterationState.STARTED,
        fromBlock: previous.toBlock + 1,
        toBlock: currentConfirmedBlock,
      });
      previous = iteration!;
      previous.state = IterationState.COMPLETED;

      // As no more confirmed blocks available, the iteration plan is null so we can skip
      await expect(bot['planIteration'](previous)).resolves.toBeNull();
      // Testing two iterations in row without new blocks
      await expect(bot['planIteration'](previous)).resolves.toBeNull();
      bumpCurrentBlock();

      // As the end-of-recovery block has not been processed yet, make another RECOVERY round
      iteration = await bot['planIteration'](previous);
      expect(iteration).toMatchObject({
        type: IterationType.RECOVERY,
        state: IterationState.STARTED,
        fromBlock: previous.toBlock + 1,
        toBlock: currentConfirmedBlock,
      });
      previous = iteration!;
      previous.state = IterationState.COMPLETED;


      // end-of-recovery block already processed, perform end of recovery opertions
      iteration = await bot['planIteration'](previous);
      expect(iteration).toMatchObject({
        type: IterationType.RECOVERY_END,
        state: IterationState.STARTED,
        toBlock: previous.toBlock, 
      });
      previous = iteration!;
      previous.state = IterationState.COMPLETED;

      // no more blocks confirmed, wait
      await expect(bot['planIteration'](previous)).resolves.toBeNull();
      bumpCurrentBlock();

      // after recovery mode, perform normal operations
      iteration = await bot['planIteration'](previous);
      expect(iteration).toMatchObject({
        type: IterationType.NORMAL,
        state: IterationState.STARTED,
        fromBlock: previous.toBlock + 1,
        toBlock: currentConfirmedBlock,
      });
      previous = iteration!;
      previous.state = IterationState.COMPLETED;

      // no more blocks confirmed, wait
      await expect(bot['planIteration'](previous)).resolves.toBeNull();
      bumpCurrentBlock();

      // perform another round of normal operations
      iteration = await bot['planIteration'](previous);
      expect(iteration).toMatchObject({
        type: IterationType.NORMAL,
        state: IterationState.STARTED,
        fromBlock: previous.toBlock + 1,
        toBlock: currentConfirmedBlock,
      });
    });
  });

  describe('processPongs', () => {
    const fromBlock = 5;
    const toBlock = 10;

    it('should search for new pongs in the blocks range', async () => {
      mockClient.getPongs.mockResolvedValueOnce([]);

      await bot['processPongs'](fromBlock, toBlock, true);

      expect(mockClient.getPongs).toHaveBeenCalledTimes(1);
      expect(mockClient.getPongs).toHaveBeenCalledWith(fromBlock, toBlock); 
    });

    it('should do nothing if no pongs are found', async () => {
      storage.getExchange = jest.fn();
      mockClient.getPongs.mockResolvedValueOnce([]);

      await bot['processPongs'](fromBlock, toBlock, true);

      expect(storage.getExchange).toHaveBeenCalledTimes(0);
    });

    describe('under normal mode', () => {
      const isRecoveryModeEnabled = false;
      const mockPong = {
        transactionHash: generateRandomHash(),
        blockNumber: 5,
        data: generateRandomHash(),
      };
      beforeEach(() => {
        mockClient.getPongs.mockResolvedValueOnce([mockPong as Log]);
      });

      it('should complete exchanges when pongs appears in confirmed blocks', async () => {
        const existingExchange = await storage.putPongIssued({
          pingHash: mockPong.data,
          pingBlock: 1,
          pongHash: mockPong.transactionHash,
          pongNonce: 2,
        });

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);

        const updatedExchange = await storage.getExchange(mockPong.data);
        expect(updatedExchange).toMatchObject({
          ...existingExchange,
          state: IterationState.COMPLETED,
          pongBlock: mockPong.blockNumber,
        });
      });

      it('should ignore a pong not related to a known ping', async () => {
        storage.putCompletedExchange = jest.fn();

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        expect(storage.putCompletedExchange).toHaveBeenCalledTimes(0);
      });

      it('should ignore a pong when we have still not issued one', async () => {
        storage.putCompletedExchange = jest.fn();
        await storage.putPingDetected({
          pingHash: mockPong.data,
          pingBlock: 1,
        });

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        expect(storage.putCompletedExchange).toHaveBeenCalledTimes(0);
      });

      it('should ignore a pong when it is not the one pending for confirmation', async () => {
        storage.putCompletedExchange = jest.fn();
        await storage.putPongIssued({
          pingHash: mockPong.data,
          pingBlock: 1,
          pongHash: generateRandomHash(),
          pongNonce: 2,
        });

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        expect(storage.putCompletedExchange).toHaveBeenCalledTimes(0);
      });
    });

    describe('under recovery mode', () => {
      const isRecoveryModeEnabled = true;
      const mockPong = {
        transactionHash: generateRandomHash(),
        blockNumber: 5,
        data: generateRandomHash(),
      };
      const mockTransaction = {
        from: generateRandomAddress(),
        to: generateRandomAddress(),
        nonce: 33,
      } as TransactionResponse;

      beforeEach(() => {
        mockClient.getPongs.mockResolvedValueOnce([mockPong as Log]);
        mockClient.getTransaction.mockResolvedValueOnce(mockTransaction);
      });

      it('should gather the transaction details for the pongs', async () => {
        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        expect(mockClient.getTransaction).toHaveBeenCalledWith(mockPong.transactionHash);
      });

      it('should complete exchanges when pongs are confirmed', async () => {
        mockClient.getWalletAddress.mockReturnValueOnce(mockTransaction.from);

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        const exchange = await storage.getExchange(mockPong.data);
        expect(exchange).toMatchObject({
          state: IterationState.COMPLETED,
          pingHash: mockPong.data,
          pongHash: mockPong.transactionHash,
          pongBlock: mockPong.blockNumber,
          pongNonce: mockTransaction.nonce,
        });
      });

      it('should ignore pongs not issued from the configured wallet', async () => {
        mockClient.getWalletAddress.mockReturnValueOnce(generateRandomAddress());
        storage.putCompletedExchange = jest.fn();

        await bot['processPongs'](fromBlock, toBlock, isRecoveryModeEnabled);
        expect(storage.putCompletedExchange).toHaveBeenCalledTimes(0);
      });
    });
  });

  describe('processPings', () => {
    const mockNonce = 10;
    const fromBlock = 1;
    const toBlock = 20;

    beforeEach(() => {
      mockClient.getNonce.mockResolvedValueOnce(mockNonce);
    });

    it('should search for new pings in the blocks range', async () => {
      mockClient.getPings.mockResolvedValueOnce([]);

      await bot['processPings'](fromBlock, toBlock);

      expect(mockClient.getPings).toHaveBeenCalledTimes(1);
      expect(mockClient.getPings).toHaveBeenCalledWith(fromBlock, toBlock); 
    });

    it('should do nothing if no pings are found', async () => {
      mockClient.getPings.mockResolvedValueOnce([]);

      await bot['processPings'](fromBlock, toBlock);

      expect(mockClient.getNonce).toHaveBeenCalledTimes(0);
    });

    it('should skip pings already processed', async () => {
      const mockPing = {
        transactionHash: generateRandomHash(),
        blockNumber: fromBlock,
      } as any as Log;
      mockClient.getPings.mockResolvedValueOnce([mockPing]);
      await storage.putPongIssued({
        pingHash: mockPing.transactionHash,
        pingBlock: mockPing.blockNumber,
        pongHash: generateRandomHash(),
        pongNonce: 9,
      });

      storage.putPingDetected = jest.fn();

      await bot['processPings'](fromBlock, toBlock);
      expect(storage.putPingDetected).toHaveBeenCalledTimes(0);
    });

    it('should store the pings', async () => {
      const mockPing = {
        transactionHash: generateRandomHash(),
        blockNumber: fromBlock,
      } as any as Log;
      mockClient.getPings.mockResolvedValueOnce([mockPing]);

      await bot['processPings'](fromBlock, toBlock);
      const stored = await storage.getExchange(mockPing.transactionHash);
      expect(stored).toMatchObject({
        state: 'detected',
        pingHash: mockPing.transactionHash,
        pingBlock: mockPing.blockNumber,
      });
    });
  });

  describe('cleanup', () => {
    it('should call the storage method for cleaning', async () => {
      storage.removeCompletedExchanges = jest.fn().mockResolvedValueOnce([]);
      await bot['cleanup']();
      expect(storage.removeCompletedExchanges).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledTimes(0);
    }); 

    it('should notify of removals', async () => {
      storage.removeCompletedExchanges = jest.fn().mockResolvedValueOnce([{
        state: IterationState.COMPLETED,
        //... other values
      }]);
      await bot['cleanup']();
      expect(storage.removeCompletedExchanges).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.info.mock.calls[0][1]).toBe('completed exchanges deleted');
    }); 
  });

  describe('processStalePongs', () => {
    beforeEach(async () => {
      mockClient.calculateTransactionBumpFees = jest.fn().mockReturnValue(mockFeeData);
      mockClient.searchMempoolTransaction = jest.fn().mockResolvedValue(undefined);
    });

    it('should do nothing if there are no issued pongs', async () => {
      await bot['processStalePongs']();
      expect(mockClient.getTransaction).toHaveBeenCalledTimes(0);
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(0);
    });

    it('should do nothing if the pongs are not stalled', async () => {
      await storage.putPongIssued({
        pingHash: generateRandomHash(),
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
      });
      await bot['processStalePongs']();
      expect(mockClient.getTransaction).toHaveBeenCalledTimes(0);
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(0);
    });

    it('should do nothing if a stale pong has been mined', async () => {
      await storage.putPongIssued({
        pingHash: generateRandomHash(),
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
        pongTimestamp: new Date(0).toISOString(),
      });
      mockClient.searchMempoolTransaction.mockResolvedValueOnce({
        providerName: 'test',
        transaction: {
          blockNumber: 123,
        } as TransactionResponse
      });
      await bot['processStalePongs']();
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(0);
    });

    it('should do nothing if a stale pong has enough gas', async () => {
      await storage.putPongIssued({
        pingHash: generateRandomHash(),
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
        pongTimestamp: new Date(0).toISOString(),
      });
      mockClient.searchMempoolTransaction.mockResolvedValueOnce({
        providerName: 'test',
        transaction: {
          blockNumber: null,
          ...mockFeeData,
        } as TransactionResponse
      });
      mockClient.calculateTransactionBumpFees.mockReset().mockReturnValueOnce(null);
      await bot['processStalePongs']();
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(0);
    });

    it('should increase the gas of a stale pong', async () => {
      const pingHash = generateRandomHash();
      const staleDate = new Date(0).toISOString();
      await storage.putPongIssued({
        pingHash,
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
        pongTimestamp: staleDate,
      });
      mockClient.searchMempoolTransaction.mockResolvedValueOnce({
        providerName: 'test provider name',
        transaction: {
          blockNumber: null,
          maxFeePerGas: 3n,
          maxPriorityFeePerGas: 1n,
        } as TransactionResponse
      });
      await bot['processStalePongs']();

      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(1);
      const [ call ] = mockClient.bumpTransactionFees.mock.calls;
      expect(call[1]).toMatchObject(mockFeeData);
      expect(call[2]).toEqual('test provider name');
      expect(mockClient.pong).toHaveBeenCalledTimes(0);

      const stored = await storage.getExchange(pingHash) as PongIssuedExchange;
      expect(stored.pongTimestamp).not.toBe(staleDate);
    });

    /*
    it.skip('should ensure the increased gas it at least a 10% more rounded up', async () => {
      mockClient['feeData'] = {
        maxPriorityFeePerGas: 6n,
        maxFeePerGas: 12n,
      };
      const pingHash = generateRandomHash();
      const staleDate = new Date(0).toISOString();
      await storage.putPongIssued({
        pingHash,
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
        pongTimestamp: staleDate,
      });
      mockClient.getTransaction.mockResolvedValueOnce({
        blockNumber: null,
        maxFeePerGas: 11n,
        maxPriorityFeePerGas: 8n,
      } as TransactionResponse);

      await bot['processStalePongs']();

      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(1);
      const [ call ] = mockClient.bumpTransactionFees.mock.calls;
      expect(call[1]).toStrictEqual(13n);
      expect(mockClient.pong).toHaveBeenCalledTimes(0);

      const stored = await storage.getExchange(pingHash) as PongIssuedExchange;
      expect(stored.pongTimestamp).not.toBe(staleDate);
    });
    */

    it('should reissue a transaction if it is not found', async () => {
      const initialExchange = await storage.putPongIssued({
        pingHash: generateRandomHash(),
        pingBlock: 1,
        pongHash: generateRandomHash(),
        pongNonce: 33,
        pongTimestamp: new Date(0).toISOString(),
      });
      mockClient.getTransaction.mockResolvedValueOnce(null);
      const mockPongHash = generateRandomHash();
      mockClient.pong.mockResolvedValueOnce({ pongHash: mockPongHash });

      await bot['processStalePongs']();

      expect(mockClient.pong).toHaveBeenCalledTimes(1);
      expect(mockClient.bumpTransactionFees).toHaveBeenCalledTimes(0);

      const stored = await storage.getExchange(initialExchange.pingHash) as PongIssuedExchange;
      expect(stored.pongHash).toBe(mockPongHash);
      expect(stored.pongTimestamp).not.toBe(initialExchange.pongTimestamp);
    });
  });

  describe('processMempool', () => {
    it('should store any issued pong from our address that is found in the mempool', async () => {
      const mockPong = {
        pingHash: generateRandomHash(),
        pingBlock: 5,
        pongHash: generateRandomHash(),
        pongNonce: 33,
      };
      mockClient.getMyMempoolPongs.mockResolvedValueOnce([mockPong]);
      await bot['processMempool']();

      const exchange = await storage.getExchange(mockPong.pingHash);
      expect(exchange).toMatchObject({
        ...mockPong,
        state: 'pong_issued',
      });
    });

    it('should do nothing if mempool contains no pong from our address', async () => {
      mockClient.getMyMempoolPongs.mockResolvedValueOnce([]);
      storage.putPongIssued = jest.fn();
      await bot['processMempool']();

      expect(storage.putPongIssued).toHaveBeenCalledTimes(0);
    });
  });

  describe('answerPendingPings', () => {
    it('should obtain the list of pings without pong issued', async () => {
      storage.getPingDetectedExchanges = jest.fn().mockResolvedValue([]);
      await bot['answerPendingPings']();
      expect(storage.getPingDetectedExchanges).toHaveBeenCalledTimes(1);
    });

    it('should do nothing if there is none', async () => {
      await bot['answerPendingPings']();
      expect(mockClient.getNonce).toHaveBeenCalledTimes(0);
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
    }); 

    it('should issue a pong for a pending ping', async () => {
      const mockExchange = {
        pingHash: generateRandomHash(),
        pingBlock: 5,
      };
      await storage.putPingDetected(mockExchange);

      const mockNonce = 33;
      mockClient.getNonce.mockResolvedValueOnce(mockNonce);

      const mockPongTx = {
        pongHash: generateRandomHash(),
      };
      mockClient.pong.mockResolvedValueOnce(mockPongTx);

      await bot['answerPendingPings']();
      expect(mockClient.pong).toHaveBeenCalledTimes(1);
      expect(mockClient.pong).toHaveBeenCalledWith(mockExchange.pingHash, {
        nonce: mockNonce,
      });
      const exchange = await storage.getExchange(mockExchange.pingHash);
      expect(exchange).toMatchObject({
        state: 'pong_issued',
        pingHash: mockExchange.pingHash,
        pingBlock: mockExchange.pingBlock,
        pongHash: mockPongTx.pongHash,
        pongNonce: mockNonce,
      });
    }); 

    it('should issue the pongs with the expected nonce', async () => {
      const mockExchanges = [
        { pingHash: generateRandomHash(), pingBlock: 5 },
        { pingHash: generateRandomHash(), pingBlock: 5 },
        { pingHash: generateRandomHash(), pingBlock: 5 },
      ];
      await Promise.all(mockExchanges.map(storage.putPingDetected.bind(storage)));
      const mockNonce = 33;
      mockClient.getNonce.mockResolvedValueOnce(mockNonce);
      mockClient.pong.mockImplementation(async () => ({ pongHash: generateRandomHash() }));

      await bot['answerPendingPings']();

      expect(mockClient.pong).toHaveBeenCalledTimes(mockExchanges.length);
      await Promise.all(mockClient.pong.mock.calls.map(async (call, i) => {
        const [pingHash, opts] = call;
        expect(mockExchanges.some((exchange) => exchange.pingHash === pingHash)).toBe(true);
        expect(opts).toMatchObject({ nonce: mockNonce + i });
      }));
    });

    it('should skip pings with pongs already issued', async () => {
      const ping = await storage.putPongIssued({
        pingHash: generateRandomHash(),
        pingBlock: 10,
        pongHash: generateRandomHash(),
        pongNonce: 42,
      });

      await bot['answerPendingPings']();
      expect(mockClient.pong).toHaveBeenCalledTimes(0);
      const stored = await storage.getExchange(ping.pingHash);
      expect(stored).toMatchObject(ping);
    });
  });

  describe('stop', () => {
    it('should return a promise and set the resolver callback as onReadyToClose', async () => {
      expect(bot['onReadyToClose']).toBeUndefined();
      const promise = bot.stop();
      expect(bot['onReadyToClose']).toBeInstanceOf(Function);
      expect(promise).toBeInstanceOf(Promise);

      const resolvedValue = 'resolved value';
      bot['onReadyToClose']!(resolvedValue);
      await expect(promise).resolves.toStrictEqual(resolvedValue);
    });
  });
});
