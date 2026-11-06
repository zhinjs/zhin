import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { replyLedger } from '../../../../src/identity.js';
import { ledgerServiceToken } from '../../../../src/runtime.js';
import { ledgerCallerFromTool } from '../../../../src/tool-caller.js';

export default defineAgentTool({
  description:
    'List personal expense entries for today, this week, or this month with their sequence numbers (#id).',
  requiresApproval: 'never',
  readOnly: true,
  tags: ['ledger', 'finance'],
  keywords: ['账单', '账目列表', '消费明细', 'ledger list', 'expenses'],
  inputSchema: z.object({
    period: z.enum(['today', 'week', 'month']).default('today').describe('Time period: today, week, or month'),
  }),
  async execute({ period = 'today' }, context) {
    return replyLedger(async () => {
      const caller = ledgerCallerFromTool(context);
      const service = context.use(ledgerServiceToken);
      return service.listEntries(caller, period);
    });
  },
});
