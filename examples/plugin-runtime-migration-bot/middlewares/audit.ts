import { defineMiddleware } from '@zhin.js/middleware';

export default defineMiddleware({
  async handle(_context, next) {
    await next();
  },
});
