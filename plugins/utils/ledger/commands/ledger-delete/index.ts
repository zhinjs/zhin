import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '删除自己的一笔记账：删账 <编号>',
  alias: ['删账'],
  params: {
    id: { type: 'integer', min: 1, description: '账目编号（记账回复或「账单」中的 #编号）' },
  },
  async execute({ input, params, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      return use(ledgerServiceToken).deleteEntry(caller, params.id);
    });
  },
});
