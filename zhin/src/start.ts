import path from 'path';
import { createApp } from '@zhinjs/core';
let { mode = '', entry, init } = process.env;
const entryPath = path.resolve(__dirname, entry);
(async () => {
  const errorHandler = e => console.error(e);

  process.on('unhandledRejection', errorHandler);
  process.on('uncaughtException', errorHandler);
  const { initialApp } = await import(entryPath);
  const app = createApp();
  if (init === '1') {
    await initialApp.apply(app);
  }
  app.start(mode);
})();
