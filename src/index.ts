/**
  * Application start script
  *
  * Configures dependencies and starts the bot
  */

import { setupGracefulShutdown } from './lib/shutdown';
import logger from './lib/logger';
import { Storage } from './lib/storage';
import EthereumService from './lib/ethereum_service';
import PingPongBot from './ping_pong_bot';

logger.warn('starting');

const storage = new Storage();
const client = new EthereumService();
const bot = new PingPongBot(client, storage, logger);

setupGracefulShutdown(storage, bot);

bot.start();
