import { defineCommand } from 'zhin.js/command';
import { sixtySClientToken } from '../src/client.js';
import handler from '../src/handlers/exchange-rate.js';

export default defineCommand({
  description: '货币汇率',
  execute: ({ args, use }) => handler(use(sixtySClientToken), {
    from: args[0] != null ? String(args[0]) : undefined,
    to: args[1] != null ? String(args[1]) : undefined,
  }),
});
