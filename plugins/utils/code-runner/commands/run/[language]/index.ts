import { defineCommand, type CommandParameterValue } from 'zhin.js/command';
import { resolveCodeRunnerBackend, type CodeRunnerConfig } from '../../../src/config.js';
import { formatResult, languageAliases, MAX_CODE_LENGTH, normalizeLanguage, runCode, supportedLanguages } from '../../../src/run-code.js';

const aliasList = Object.keys(languageAliases).join(', ');

export default defineCommand<CodeRunnerConfig>({
  description: '在配置的代码运行后端中运行代码片段', descriptionI18n: { en: "Run a code snippet on the configured code-runner backend" },
  params: {
    language: {
      type: 'string', description: `执行语言：${supportedLanguages.join(', ')}；别名：${aliasList}（不区分大小写）`, descriptionI18n: { en: `Language: ${supportedLanguages.join(', ')}; aliases: ${aliasList} (case-insensitive)` },
      validate: (value: CommandParameterValue) => typeof value === 'string' && normalizeLanguage(value) !== undefined,
    },
    code: { type: 'text', min: 1, max: MAX_CODE_LENGTH, description: '要运行的代码', descriptionI18n: { en: "Code to execute" } },
  },
  options: { timeout: { type: 'integer', alias: 't', default: 30, min: 1, max: 30, description: '请求超时（秒）', descriptionI18n: { en: "Request timeout in seconds" } } },
  async execute({ params, options, locale, config }) {
    return formatResult(await runCode(params.language, params.code, options.timeout, locale, resolveCodeRunnerBackend(config)), locale);
  },
});
