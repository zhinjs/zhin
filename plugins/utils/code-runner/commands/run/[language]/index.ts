import { defineCommand, type CommandParameterValue } from 'zhin.js/command';
import { formatResult, MAX_CODE_LENGTH, runCode, supportedLanguages } from '../../../src/run-code.js';

export default defineCommand({
  description: '在远程沙箱中运行代码片段', descriptionI18n: { en: "Run a code snippet in a remote sandbox" },
  params: {
    language: {
      type: 'string', description: `执行语言：${supportedLanguages.join(', ')}（不区分大小写）`, descriptionI18n: { en: `Language: ${supportedLanguages.join(', ')} (case-insensitive)` },
      validate: (value: CommandParameterValue) => typeof value === 'string' && supportedLanguages.includes(value.toLowerCase().trim()),
    },
    code: { type: 'text', min: 1, max: MAX_CODE_LENGTH, description: '要运行的代码', descriptionI18n: { en: "Code to execute" } },
  },
  options: { timeout: { type: 'integer', alias: 't', default: 30, min: 1, max: 30, description: '请求超时（秒）', descriptionI18n: { en: "Request timeout in seconds" } } },
  async execute({ params, options, locale }) {
    return formatResult(await runCode(params.language, params.code, options.timeout, locale), locale);
  },
});
