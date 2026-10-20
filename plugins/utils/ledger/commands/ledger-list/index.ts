import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { parsePeriodWord } from '../../src/period.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '列出账目及编号（最新 20 笔）：账单 [今日|本周|本月|全部]，默认本月',
  alias: ['账单'],
  params: {
    period: { type: 'word', optional: true, description: '今日、本周、本月或全部' },
  },
  async execute({ input, params, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      const period = parsePeriodWord(params.period, 'month');
      if (!period) return '时间范围只能是：今日、本周、本月、全部';
      return use(ledgerServiceToken).listEntries(caller, period);
    });
  },
});
