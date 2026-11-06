import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { replyLedger } from '../../../../src/identity.js';
import { ledgerServiceToken } from '../../../../src/runtime.js';
import { ledgerCallerFromTool } from '../../../../src/tool-caller.js';

export default defineAgentTool({
  description:
    'View personal spending summary or category statistics for today, this week, or this month.',
  requiresApproval: 'never',
  readOnly: true,
  tags: ['ledger', 'finance'],
  keywords: ['消费汇总', '分类统计', '账单统计', 'ledger summary', 'spending'],
  inputSchema: z.object({
    period: z.enum(['today', 'week', 'month']).default('month').describe('Time period: today, week, or month'),
    mode: z.enum(['summary', 'categories']).default('summary').describe('Summary view or detailed category statistics'),
  }),
  async execute({ period = 'month', mode = 'summary' }, context) {
    return replyLedger(async () => {
      const caller = ledgerCallerFromTool(context);
      const service = context.use(ledgerServiceToken);
      if (mode === 'categories') {
        return service.categoryStatistics(caller, period);
      }
      return service.periodSummary(caller, period);
    });
  },
});
