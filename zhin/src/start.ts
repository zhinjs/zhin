import { CONFIG_DIR, createApp } from '@zhinjs/core';
import { initialApp } from '.';
import { sleep } from '@zhinjs/shared';
import process from 'process';
const errorHandler = (e: unknown) => console.error(e);

(async () => {
  let { init } = process.env;
  process.on('unhandledRejection', errorHandler);
  process.on('uncaughtException', errorHandler);
  const app = createApp();
  if (init === '1') {
    if (app.config.has_init) {
      app.logger.info('zhin app has already initialized, skipping initialization');
      return process.exit();
    }
    app.logger.info('initializing');
    await initialApp.apply(app);
    app.logger.info('initialized,process will exit after 3 seconds');
    app.logger.info(`please run 'npm start' to start zhin app`);
    await sleep(3000);
    return process.exit();
  }
  app.start(process.env.mode || 'prod');
})();
