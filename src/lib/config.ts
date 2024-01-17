/**
  * Configuration values
  *
  * Reads and validates environment variables
  */
import { join, resolve } from 'node:path';
import { cleanEnv, str, num } from 'envalid';

export default cleanEnv(process.env, {
  CONTRACT_ADDRESS: str(),
  WALLET_PRIVATE_KEY: str(),
  STARTING_BLOCK: num(),
  DATA_PATH: str({ default: resolve(join(__dirname, '..', '..', 'data')) }),

  // Performance/security
  CONFIRMATION_BLOCKS: num({ default: 20 }),
  STALE_PONG_TIMEOUT_MINUTES: num({ default: 15 }),
  COOLDOWN_PERIOD_MINUTES: num({ default: 2 }),
  MAX_BLOCKS_BATCH_SIZE: num({ default: 1000 }),
  PROVIDERS_RPS: num({ default: 3 }),

  // API keys, defaulting to - to disable the missing ones
  ALCHEMY_API_KEY: str({ default: '-' }),
  ANKR_API_KEY: str({ default: '-' }),
  INFURA_API_KEY: str({ default: '-' }),
});
