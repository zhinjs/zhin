import { Command } from 'commander';

export const agentCommand = new Command('agent')
  .description('Agent authoring surface diagnostics (ADR 0039 P2)');

agentCommand
  .command('info')
  .description('List discovered agent/ surfaces (Eve info parity)')
  .option('--json', 'Output JSON report')
  .action(async (opts: { json?: boolean }) => {
    let mod: typeof import('@zhin.js/agent');
    try {
      mod = await import('@zhin.js/agent');
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
    console.log(mod.formatAgentSurfaceInfoReport(report));
  });
