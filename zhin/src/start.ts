import { createApp } from '@zhinjs/core';
let { init } = process.env;
(async () => {
  const errorHandler = (e: unknown) => console.error(e);

  process.on('unhandledRejection', errorHandler);
  process.on('uncaughtException', errorHandler);
  const { initialApp } = await import(__dirname);
  const app = createApp();
  if (init === '1') {
    await initialApp.apply(app);
  }
  app.start();
})();
