import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '查看本周（周一至周日）消费合计与分类明细',
  alias: ['本周消费'],
  async execute({ input, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      return use(ledgerServiceToken).periodSummary(caller, 'week');
    });
  },
});
