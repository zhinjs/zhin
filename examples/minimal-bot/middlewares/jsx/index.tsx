import { defineMiddleware } from 'zhin.js/middleware';
import type { Message } from 'zhin.js';

export default defineMiddleware<Message>({
  handle({ input }, next) {
    if (input.content === 'jsx?') return <p><strong>JSX ready</strong>：来自入站中间件</p>;
    return next();
  },
});
