import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '记一笔消费：记 <类别> <金额> [备注]',
  alias: ['记'],
  params: {
    entry: { type: 'text', min: 1, max: 200, description: '类别 金额 [备注]，例如：午饭 18.5 和同事' },
  },
  async execute({ input, params, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      return use(ledgerServiceToken).addEntry(caller, params.entry);
    });
  },
});
