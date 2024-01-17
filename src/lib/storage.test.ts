import {
  Storage,
} from './storage';
import config from './config';
import { generateRandomHash } from './test_utils';
import {
  IterationState,
  IterationType,
  type NormalIteration,
  type CompletedExchange,
  type PingDetectedExchange,
  type PongIssuedExchange,
} from '../types';

describe('Storage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage({ inMemory: true });
  });

  describe('setIteration', () => {
    it('should store the iteration and return it', async () => {
      const iteration: NormalIteration = {
        type: IterationType.NORMAL,
        state: IterationState.COMPLETED,
        fromBlock: 1,
        toBlock: 2,
      };

      const returned = await storage.setIteration(iteration);
      expect(returned).toMatchObject(iteration);
      const stored = await storage.getIteration();
      expect(stored).toMatchObject(iteration);
    });
  });

  describe('getIteration', () => {
    it('should retrieve the stored iteration', async () => {
      const stored: NormalIteration = {
        type: IterationType.NORMAL,
        state: IterationState.COMPLETED,
        fromBlock: 1,
        toBlock: 2,
      };
      await storage.setIteration(stored);
      const retrieved = await storage.getIteration();
      expect(retrieved).toMatchObject(stored);
    });

    it('should return undefined if there is no iteration stored', async () => {
      const retrieved = await storage.getIteration();
      expect(retrieved).toBeUndefined();
    });
  });

  describe('putPingDetectedExchange', () => {
    it('should store the iteration and return it', async () => {
      const exchange: Omit<PingDetectedExchange, 'state'> = {
        pingHash: generateRandomHash(),
        pingBlock: 33,
      };

      const returned = await storage.putPingDetected(exchange);
      const expected = { ...exchange, state: 'detected' };
      expect(returned).toMatchObject(expected);
      const stored = await storage.getExchange(exchange.pingHash);
      expect(stored).toMatchObject(expected);
    });
  });

  describe('getPingDetectedExchanges', () => {
    it('should return the stored PingDetectedExchanges', async () => {
      const expected: Omit<PingDetectedExchange, 'state'>[] = Array.from({ length: 4 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
      }));
      const others: Omit<PongIssuedExchange, 'state' | 'timestamp'>[] = Array.from({ length: 3 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
        pongHash: generateRandomHash(),
        pongBlock: 10,
        pongNonce: 133,
        pongTimestamp: new Date().toISOString()
      }));
      await Promise.all([
        ...expected.map((exchange) => storage.putPingDetected(exchange)),
        ...others.map((exchange) => storage.putPongIssued(exchange)),
      ]);

      const returned = await storage.getPingDetectedExchanges();
      expect(returned).toHaveLength(expected.length);
      returned.forEach((exchange) => expect(expected.some(({ pingHash }) => pingHash === exchange.pingHash)));
    });
  });

  describe('putPongIssued', () => {
    it('should store the exchange and return it', async () => {
      const exchange: Omit<PongIssuedExchange, 'state' | 'pongTimestamp'> = {
        pingHash: generateRandomHash(),
        pingBlock: 33,
        pongHash: generateRandomHash(),
        pongNonce: 1,
      };

      const returned = await storage.putPongIssued(exchange);
      const stored = await storage.getExchange(exchange.pingHash) as PongIssuedExchange;

      [returned, stored].forEach((result: PongIssuedExchange) => {
        expect(result).toMatchObject({ ...exchange, state: 'pong_issued' });
        expect(returned.pongTimestamp).toBeDefined();
      });
    });
  });

  describe('putCompletedExchanges', () => {
    it('should store the exchange and return it', async () => {
      const exchange: Omit<CompletedExchange, 'state'> = {
        pingHash: generateRandomHash(),
        pingBlock: 33,
        pongHash: generateRandomHash(),
        pongBlock: 57,
        pongNonce: 1,
        pongTimestamp: new Date().toISOString(),
      };

      const returned = await storage.putCompletedExchange(exchange);
      expect(returned).toMatchObject({ ...exchange, state: 'completed' });

      const stored = await storage.getExchange(exchange.pingHash) as CompletedExchange;
      expect(stored).toMatchObject({ ...exchange, state: 'completed' });
    });
  });

  describe('getStalePongIssuedExchanges', () => {
    it('should return the PongIssuedExchanges that are not confirmed after STALE_PONG_TIMEOUT_MINUTES', async () => {
      const staleDate = new Date(Date.now() - (config.STALE_PONG_TIMEOUT_MINUTES * 60_000));
      const expected: Omit<PongIssuedExchange, 'state'>[] = Array.from({ length: 3 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
        pongHash: generateRandomHash(),
        pongBlock: 10,
        pongNonce: 133,
        pongTimestamp: staleDate.toISOString()
      }));
      const notStale: Omit<PongIssuedExchange, 'state'>[] = Array.from({ length: 3 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
        pongHash: generateRandomHash(),
        pongBlock: 10,
        pongNonce: 133,
        pongTimestamp: new Date().toISOString()
      }));
      const others: Omit<PingDetectedExchange, 'state'>[] = Array.from({ length: 4 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
      }));
      await Promise.all([
        [...expected, ...notStale].map((exchange) => storage.putPongIssued(exchange)),
        ...others.map((exchange) => storage.putPingDetected(exchange)),
      ]);

      const returned = await storage.getStalePongIssuedExchanges();
      expect(returned).toHaveLength(expected.length);
      returned.forEach((exchange) => expect(expected.some(({ pingHash }) => pingHash === exchange.pingHash)));
    });
  });

  describe('getExchange', () => {
    it('should return an exchange', async () => {
      const stored = await storage.putCompletedExchange({
        pingHash: generateRandomHash(),
        pingBlock: 2,
        pongHash: generateRandomHash(),
        pongBlock: 5,
        pongNonce: 33,
        pongTimestamp: new Date().toISOString()
      });
      const retrieved = await storage.getExchange(stored.pingHash);
      expect(retrieved).toMatchObject(stored);
    });

    it('should return undefined when the exchange is not found', async () => {
      const retrieved = await storage.getExchange(generateRandomHash());
      expect(retrieved).toBeUndefined();
    });
  });

  describe('removeCompletedExchanges', () => {
    it('should remove all the completed exchanges', async () => {
      const completedExchanges: Omit<CompletedExchange, 'state'>[] = Array.from({ length: 4 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
        pongHash: generateRandomHash(),
        pongBlock: 5,
        pongNonce: 33,
        pongTimestamp: new Date().toISOString()
      }));
      const otherExchanges: Omit<PingDetectedExchange, 'state'>[] = Array.from({ length: 3 }, () => ({
        pingHash: generateRandomHash(),
        pingBlock: 2,
      }));
      await Promise.all([
        ...completedExchanges.map((exchange) => storage.putCompletedExchange(exchange)),
        ...otherExchanges.map((exchange) => storage.putPingDetected(exchange)),
      ]);

      const removed =await storage.removeCompletedExchanges();
      expect(removed).toHaveLength(completedExchanges.length);

      await Promise.all([
        completedExchanges.map((exchange) => {
          return expect(storage.getExchange(exchange.pingHash)).resolves.toBeUndefined();
        }),
        otherExchanges.map((exchange) => {
          return expect(storage.getExchange(exchange.pingHash)).resolves.toMatchObject(exchange);
        }),
      ]);
    });
  });

  describe('close', () => {
    it('should close the db and resolve the promise once it is done', async () => {
      storage['db'].close = jest.fn().mockImplementation((callback) => callback());
      await expect(storage.close()).resolves.toBeUndefined();
      expect(storage['db'].close).toHaveBeenCalledTimes(1);
    });

    it('should reject with an error if the db fails to close', async () => {
      const error = new Error();
      storage['db'].close = jest.fn().mockImplementation((callback) => callback(error));
      await expect(storage.close()).rejects.toStrictEqual(error);
      expect(storage['db'].close).toHaveBeenCalledTimes(1);
    });
  });

  it('should present no errors when instantiating with persistence', async () => {
    new Storage();
  });

});
