import { WORK_DIR, createApp } from '@zhinjs/core';
import '@zhinjs/core/register';
import { initialApp } from '.';
import { sleep } from '@zhinjs/shared';
import process from 'process';
import * as fs from 'fs';
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
    const pkg = JSON.parse(fs.readFileSync(`${WORK_DIR}/package.json`, 'utf-8'));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.start = 'zhin start';
    pkg.scripts['dev'] = 'zhin -m dev';
    fs.writeFileSync(`${WORK_DIR}/package.json`, JSON.stringify(pkg, null, 2));
    app.logger.info('initialized,process will exit after 3 seconds');
    app.logger.info(`please run 'npm start' to start zhin in production mode`);
    app.logger.info('you can run `npm run dev` to start zhin with dev mode');
    await sleep(3000);
    return process.exit();
  }
  app.start(process.env.mode || 'prod');
})();
