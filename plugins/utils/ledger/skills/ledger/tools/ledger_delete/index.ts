import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { replyLedger } from '../../../../src/identity.js';
import { ledgerServiceToken } from '../../../../src/runtime.js';
import { ledgerCallerFromTool } from '../../../../src/tool-caller.js';

export default defineAgentTool({
  description:
    'Delete one of the current user’s expense entries by its sequence number (#id).',
  requiresApproval: 'always',
  tags: ['ledger', 'finance'],
  keywords: ['删账', '删除记账', 'delete expense', 'ledger delete'],
  inputSchema: z.object({
    seq: z.number().int().positive().describe('Per-user entry sequence number (#id)'),
  }),
  async execute({ seq }, context) {
    return replyLedger(async () => {
      const caller = ledgerCallerFromTool(context);
      const service = context.use(ledgerServiceToken);
      return service.deleteEntry(caller, seq);
    });
  },
});
