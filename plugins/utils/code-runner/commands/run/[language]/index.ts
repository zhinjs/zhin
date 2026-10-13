import { defineCommand, type CommandParameterValue } from 'zhin.js/command';
import { formatResult, MAX_CODE_LENGTH, runCode, supportedLanguages } from '../../../src/run-code.js';

export default defineCommand({
  description: '在远程沙箱中运行代码片段',
  params: {
    language: {
      type: 'string', description: `执行语言：${supportedLanguages.join(', ')}（不区分大小写）`,
      validate: (value: CommandParameterValue) => typeof value === 'string' && supportedLanguages.includes(value.toLowerCase().trim()),
    },
    code: { type: 'text', min: 1, max: MAX_CODE_LENGTH, description: '要运行的代码' },
  },
  options: { timeout: { type: 'integer', alias: 't', default: 30, min: 1, max: 30, description: '请求超时（秒）' } },
  async execute({ params, options }) {
    return formatResult(await runCode(params.language, params.code, options.timeout));
  },
});
