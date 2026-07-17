import { defineLegacyMiddleware } from '@zhin.js/next-compat';

export default defineLegacyMiddleware(async (_message, next) => {
  await next();
});
