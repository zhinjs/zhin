import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '查看今日消费合计与分类明细',
  alias: ['今日消费'],
  async execute({ input, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      return use(ledgerServiceToken).periodSummary(caller, 'today');
    });
  },
});
