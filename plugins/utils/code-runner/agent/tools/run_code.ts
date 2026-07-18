import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { formatResult, runCode } from '../../src/run-code.js';

export default defineAgentTool<{ language: string; code: string }>({
  description: '在沙箱中运行代码片段，返回 stdout/stderr/error',
  inputSchema: z.object({
    language: z.string().min(1),
    code: z.string().min(1),
  }),
  keywords: ['运行代码', '执行代码', 'run code', 'execute', '代码'],
  tags: ['code', 'run', 'execute', 'sandbox'],
  async execute({ language, code }) {
    const result = await runCode(language, code);
    return formatResult(result);
  },
});
