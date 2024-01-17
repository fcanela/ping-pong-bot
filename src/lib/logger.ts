import { join } from 'node:path';
import pino from 'pino';
import config from './config';

const transport = pino.transport({
  targets: [
    {
      level: 'warn',
      target: 'pino/file',
      options: {
        destination: join(config.DATA_PATH, 'logs'),
        mkdir: true,
      },
    }, 
    {
      level: 'debug',
      target: 'pino/file',
      options: {
        destination: join(config.DATA_PATH, 'debug'),
        mkdir: true,
      },
    }, 
    {
      level: 'debug',
      target: 'pino-pretty',
    }
  ],
});

export default pino({ timestamp: pino.stdTimeFunctions.isoTime }, transport);
