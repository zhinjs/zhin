/**
 * @zhin.js/plugin-code-runner
 *
 * 沙箱代码执行插件 —— 通过 glot.io API 安全运行代码片段
 */
import { formatCompact, MessageCommand, usePlugin } from 'zhin.js';
import { formatResult, runCode } from './run-code.js';

const { addCommand, logger } = usePlugin();

addCommand(
  new MessageCommand('运行 <language:text> <code:text>')
    .desc('在沙箱中运行代码片段')
    .action(async (_message, result) => {
      const { language, code } = result.params as { language: string; code: string };
      logger.debug(formatCompact({ op: 'run', language, len: code.length }));
      const res = await runCode(language, code);
      return formatResult(res);
    }),
);
