import { WORK_DIR, createApp } from '@zhinjs/core';
import '@zhinjs/core/register';
import { initialApp } from '.';
import process from 'process';
import * as fs from 'fs';
const errorHandler = (e: unknown) => console.error(e);
(async () => {
  let { init } = process.env;
  process.on('unhandledRejection', errorHandler);
  process.on('uncaughtException', errorHandler);
  const app = createApp();
  if(!app.config.has_init){
    app.logger.info('zhin app has not initialized, initializing...');
    await initialApp.apply(app);
    const pkg = JSON.parse(fs.readFileSync(`${WORK_DIR}/package.json`, 'utf-8'));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.start = 'zhin start';
    pkg.scripts['dev'] = 'zhin -m dev';
    fs.writeFileSync(`${WORK_DIR}/package.json`, JSON.stringify(pkg, null, 2));
  }else if(init === '1'){
    app.logger.warn(`zhin app has already initialized, skip initialization`);
  }
  app.start(process.env.mode || 'prod');
})();
