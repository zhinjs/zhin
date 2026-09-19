import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { formatArithmeticResult } from '../lib/safe-expr.js';

export default defineAgentTool<{ expression: string }>({
  description: 'Evaluate a safe arithmetic expression (+ - * / % and parentheses)',
  approval: 'never',
  inputSchema: z.object({
    expression: z.string().min(1).max(200),
  }),
  execute: ({ expression }) => formatArithmeticResult(expression),
});
