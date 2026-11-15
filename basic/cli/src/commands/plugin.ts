import { Command } from 'commander';
import { checkPlugin, formatPluginCheckReport } from '../plugin-check/index.js';

interface PluginCheckCommandOptions {
  pack: boolean;
  json?: boolean;
  strict?: boolean;
}

const checkCommand = new Command('check')
  .description('检查插件目录能否正确发布：package.json / zhin.entry / files / 约定目录，并实际 npm pack 检查发布包')
  .argument('[dir]', '插件目录（默认当前目录）', '.')
  .option('--no-pack', '只做静态检查，不运行 npm pack（不执行 prepack）')
  .option('--json', '以 JSON 输出检查结果')
  .option('--strict', '警告也视为失败（页面 UI 提示不算警告）')
  .addHelpText('after', [
    '',
    '默认会运行插件自己的 npm pack（含 prepack 构建），在临时目录解包后检查：',
    '  入口与 exports 是否打包、相对 import 能否解析、测试/配置是否混入、约定目录 .ts 是否都有 .js。',
    '有错误（或 --strict 下有警告）时退出码为 1。',
    '',
    '还会检查 pages/** 的页面 UI（ADR 0063 第 1–6 条：原生 <select>、自定义页头、固定内容宽度、',
    '原始样式数值、尺度外的 Tailwind 类名、原生基础控件），只给提示并附替换建议，不影响退出码。',
    '确需保留时在该行写 // zhin-ui-ignore <检查项>: <理由>（JSX 中写 {/* ... */}）。',
  ].join('\n'))
  .action(async (directory: string, options: PluginCheckCommandOptions) => {
    const report = await checkPlugin(directory, { pack: options.pack });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(formatPluginCheckReport(report, { pack: options.pack }));
    }
    const failed = report.errorCount > 0 || (options.strict === true && report.warningCount > 0);
    if (failed) process.exitCode = 1;
  });

export const pluginCommand = new Command('plugin')
  .description('插件作者工具')
  .addCommand(checkCommand);
