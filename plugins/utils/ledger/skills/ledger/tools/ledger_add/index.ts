import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { replyLedger } from '../../../../src/identity.js';
import { ledgerServiceToken } from '../../../../src/runtime.js';
import { ledgerCallerFromTool } from '../../../../src/tool-caller.js';

export default defineAgentTool({
  description:
    'Record a personal expense entry in the current user’s ledger with a category, positive amount, and optional note.',
  requiresApproval: 'always',
  tags: ['ledger', 'finance'],
  keywords: ['记账', '消费', '支出', '开销', 'ledger', 'expense'],
  inputSchema: z.object({
    category: z.string().min(1).max(32).describe('Expense category, e.g. 午饭, 打车'),
    amount: z.number().positive().describe('Expense amount in yuan, e.g. 18.5'),
    note: z.string().max(120).optional().describe('Optional note for the expense'),
  }),
  async execute({ category, amount, note }, context) {
    return replyLedger(async () => {
      const caller = ledgerCallerFromTool(context);
      const service = context.use(ledgerServiceToken);
      const text = `${category} ${amount}${note ? ` ${note}` : ''}`;
      return service.addEntry(caller, text);
    });
  },
});
