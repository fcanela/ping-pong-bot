import logger from './logger';
import type { Storage } from './storage';
import type PingPongBot from '../ping_pong_bot';

export const setupGracefulShutdown = (storage: Storage, bot: PingPongBot) => {
  async function shutdown(code = 0) {
    logger.info('waiting for the bot to finish the current iteration...');
    await bot.stop();
    logger.info('waiting for the storage to close and write any pending changes...');
    await storage.close();
    logger.info('exiting...');
    process.exit(code);
  };

  ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      logger.warn(`${signal} detected, proceeding to controlled shutdown`);
      // It is not standard to finish with exit code 0 on these signals,
      // but I will take that license to simplify code
      shutdown();
    });
  });

  ['uncaughtException', 'unhandledRejection'].forEach((event) => {
    process.on(event, (error) => {
      logger.fatal(error, `uncontrolled error caused an ${event}`);
      shutdown(1);
    })
  });
};

