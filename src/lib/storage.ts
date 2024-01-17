import { join } from 'node:path';
import { Level } from 'level';
import { MemoryLevel } from 'memory-level';
import config from './config';
import type { AbstractSublevel } from 'abstract-level';
import {
  type Exchange,
  type Iteration,
  type PingDetectedExchange,
  type PongIssuedExchange,
  type CompletedExchange,
} from '../types';

export type MainDB = Level<string, string>;
export type ExchangesDB = AbstractSublevel<MainDB, string | Buffer | Uint8Array, string, Exchange>;

type WithoutState<T> = Omit<T, 'state'>
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

type PutPingDetectedArg = WithoutState<PingDetectedExchange>;
type PutPongIssuedArg = Optional<WithoutState<PongIssuedExchange>, 'pongTimestamp'>;
type PutCompletedArg = WithoutState<CompletedExchange>

export class Storage {
  private static ITERATION_DB_KEY = 'iteration';
  private db: MainDB;
  private exchanges: ExchangesDB;

  constructor({ inMemory = false } = {}) {
    const opts = { valueEncoding: 'json' };
    this.db = inMemory
      ? new MemoryLevel(opts) as Level
      : new Level(join(config.DATA_PATH, 'db'), opts);
    this.exchanges = this.db.sublevel('exchanges', opts);
  }

  async getIteration(): Promise<Iteration | undefined> {
    // Using get throws an error if not found, getMany a null
    const [iteration] = await this.db.getMany([Storage.ITERATION_DB_KEY]);
    return iteration ? JSON.parse(iteration) : undefined;
  }

  async setIteration(iteration?: Iteration): Promise<Iteration|undefined> {
    await this.db.put(Storage.ITERATION_DB_KEY, JSON.stringify(iteration));
    return iteration;
  }

  async getExchange(pingHash: string): Promise<Exchange | undefined> {
    // Using get throws an error if not found, getMany a null
    const [exchange] = await this.exchanges.getMany([pingHash]);
    return exchange ? exchange : undefined;
  }

  async putPingDetected(fields: PutPingDetectedArg) {
    const exchange: PingDetectedExchange = {
      ...fields,
      state: 'detected',
    };
    await this.exchanges.put(exchange.pingHash, exchange);
    return exchange;
  }

  async putPongIssued(fields: PutPongIssuedArg) {
    const exchange: PongIssuedExchange = {
      pongTimestamp: new Date().toISOString(),
      ...fields,
      state: 'pong_issued',
    };
    await this.exchanges.put(exchange.pingHash, exchange);
    return exchange;
  }

  async getPingDetectedExchanges() {
    const result: PingDetectedExchange[] = [];

    for await (const exchange of this.exchanges.values()) {
      if (exchange.state !== 'detected') continue;

      result.push(exchange);
    }

    return result;
  }

  async getStalePongIssuedExchanges() {
    const result: PongIssuedExchange[] = [];

    const expiredDate = new Date(new Date().getTime() - config.STALE_PONG_TIMEOUT_MINUTES * 60_000);

    for await (const exchange of this.exchanges.values()) {
      if (exchange.state !== 'pong_issued') continue;

      const pongedAt = new Date(exchange.pongTimestamp);
      if (pongedAt <= expiredDate) result.push(exchange);
    }

    return result;
  }

  async putCompletedExchange(fields: PutCompletedArg) {
    const exchange: CompletedExchange = {
      ...fields,
      state: 'completed',
    };
    await this.exchanges.put(exchange.pingHash, exchange);
    return exchange;
  }

  async removeCompletedExchanges(): Promise<CompletedExchange[]> {
    const completed: CompletedExchange[] = [];
    for await (const exchange of this.exchanges.values()) {
      if (exchange.state === 'completed') completed.push(exchange);
    }

    if (completed.length !== 0) { 
      await this.exchanges.batch(completed.map(({ pingHash }) => ({ type: 'del', key: pingHash })));
    }

    return completed;
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((error) => {
        if (error) return reject(error);
        resolve(undefined);
      });
    });
  }
}
