import { defineCommand } from '@zhin.js/command';
import { formatResult, runCode } from '../../src/run-code.js';

export default defineCommand({
  description: '在沙箱中运行代码片段（/code-runner run <语言> <代码>）',
  async execute({ params, args }) {
    const language = String(params.language ?? '');
    // code 原来是第二动态段，约定式命令只支持单动态文件参数，改从 args 取
    const code = args.join(' ').trim();
    if (!code) return '请提供要运行的代码，例如：/code-runner run javascript alert(1+1)';
    const result = await runCode(language, code);
    return formatResult(result);
  },
});
