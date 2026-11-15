import { Command } from 'commander';
import { importProjectInstanceCli, type AgentModuleView } from '../utils/project-instance.js';
import { projectDisplayLocale } from '../utils/cli-locale.js';

// Same text as the placeholder in `cli.ts` (this module is only loaded when the command runs).
export const agentCommand = new Command('agent')
  .description('查看 Agent 能力 / Inspect Agent capabilities');

agentCommand
  .command('info')
  .description('按来源列出项目根目录、本地插件与已安装插件中的 Agent 工具、技能和命名 Agent / '
    + 'List Agent tools, skills and named Agents by source: project root, local and installed plugins')
  .option('--json', '以 JSON 输出（含 bySource 分组） / Output the report as JSON (with bySource)')
  .option('--locale <locale>', '输出语言，默认取项目 locale / Output language (zh-CN, en); defaults to the project locale')
  .action(async (opts: { json?: boolean; locale?: string }) => {
    const root = process.cwd();
    const locale = await projectDisplayLocale(root, opts.locale);
    let mod: AgentModuleView;
    try {
      mod = await (await importProjectInstanceCli(root)).loadAgentModule();
    } catch {
      console.error(locale === 'en'
        ? 'The AI stack is required (@zhin.js/agent). Run: pnpm add @zhin.js/agent zod ai'
        : '需要安装 @zhin.js/agent（AI 栈）。运行: pnpm add @zhin.js/agent zod ai');
      process.exitCode = 1;
      return;
    }

    const report = await mod.buildAgentSurfaceInfoReport(root);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(mod.formatAgentSurfaceInfoReport(report as never, locale));
  });
