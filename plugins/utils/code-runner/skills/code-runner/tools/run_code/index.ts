import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { resolveCodeRunnerBackend, type CodeRunnerConfig } from '../../../../src/config.js';
import { formatResult, runCode } from '../../../../src/run-code.js';

export default defineAgentTool<{ language: string; code: string }, string, CodeRunnerConfig>({
  description: '在配置的代码运行后端中运行代码片段，返回 stdout/stderr/error；未配置 endpoint 时返回提示',
  inputSchema: z.object({
    language: z.string().min(1),
    code: z.string().min(1),
  }),
  keywords: ['运行代码', '执行代码', 'run code', 'execute', '代码'],
  tags: ['code', 'run', 'execute', 'sandbox'],
  async execute({ language, code }, context) {
    const result = await runCode(language, code, undefined, context.locale, resolveCodeRunnerBackend(context.config));
    return formatResult(result, context.locale);
  },
});
