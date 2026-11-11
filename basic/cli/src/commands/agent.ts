import { Command } from 'commander';
import { importProjectInstanceCli, type AgentModuleView } from '../utils/project-instance.js';

export const agentCommand = new Command('agent')
  .description('Inspect Agent capabilities');

agentCommand
  .command('info')
  .description('List discovered Agent capabilities and named Agents')
  .option('--json', 'Output JSON report')
  .action(async (opts: { json?: boolean }) => {
    let mod: AgentModuleView;
    try {
      mod = await (await importProjectInstanceCli(process.cwd())).loadAgentModule();
    } catch {
      console.error(
        '需要安装 @zhin.js/agent（AI 栈）。运行: pnpm add @zhin.js/agent zod ai',
      );
      process.exitCode = 1;
      return;
    }

    const report = await mod.buildAgentSurfaceInfoReport(process.cwd());
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(mod.formatAgentSurfaceInfoReport(report as never));
  });

