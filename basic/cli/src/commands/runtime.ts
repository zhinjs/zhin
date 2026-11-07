import { writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Command } from 'commander';
import { FilePublishJournalStore } from '../plugin-runtime/publish-journal.js';
import { NodeProcessRunner, ProjectCommands } from '../plugin-runtime/project-commands.js';
import { NativeTypeScriptSupervisor, parseStartOptions } from '../plugin-runtime/start/module.js';
import { formatStartOptionHelp, generatePluginCapabilityCodegen } from '@zhin.js/runtime';

export const runtimeCommand = new Command('runtime')
  .description('管理约定式 Plugin Runtime 项目');

runtimeCommand.command('inspect')
  .action(async () => {
    const commands = new ProjectCommands();
    process.stdout.write(`${JSON.stringify(commands.describe(
      await commands.inspect(process.cwd()),
    ), null, 2)}\n`);
  });

runtimeCommand.command('codegen [dir]')
  .description('扫描约定目录并生成插件能力静态类型声明（plugin.capabilities.d.ts）与 capabilityGraph 摘要')
  .option('--write', '将生成的类型声明写入目标目录下的 plugin.capabilities.d.ts', false)
  .option('--json', '以 JSON 格式输出扫描结果', false)
  .action(async (dir = '.', options: { write?: boolean; json?: boolean }) => {
    const targetDir = resolve(process.cwd(), dir);
    const result = await generatePluginCapabilityCodegen(targetDir);
    if (options.write) {
      const outPath = join(targetDir, 'plugin.capabilities.d.ts');
      await writeFile(outPath, result.dts, 'utf8');
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${result.dts}\n${result.snippet}\n`);
  });

runtimeCommand.command('start')
  .description('启动 Bot（pnpm dev 即本命令）；选项见下方 Start options')
  .usage('[options]')
  .addHelpText('after', formatStartOptionHelp())
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_options, command) => {
    // Process supervision belongs to the executable, not the reusable startup API.
    const root = resolve(process.cwd());
    const parsed = parseStartOptions(command.args);
    if (await new NativeTypeScriptSupervisor(root, parsed).runIfRequired()) return;
    const { runStartCommand } = await import('../plugin-runtime/start-command.js');
    await runStartCommand({
      root,
      args: command.args,
      writeOutput: (value) => process.stdout.write(value),
      writeError: (value) => process.stderr.write(value),
    });
  });

runtimeCommand.command('migrate [phase]')
  .option('--check', '只生成迁移计划')
  .option('--write', '原子写入可静态迁移的能力')
  .action(async (phase = 'extract', options) => {
    const api = await import('../plugin-runtime/migrate/index.js');
    const root = resolve(process.cwd());
    if (phase === 'status') {
      const report = await new api.MigrationReadiness().inspect(root);
      process.stdout.write(`${JSON.stringify(api.relativeReadinessReport(report), null, 2)}\n`);
      process.exitCode = api.migrationStatusExitCode(report);
      return;
    }
    if (options.check === options.write) throw new Error('choose exactly one of --check or --write');
    if (phase === 'cutover') {
      const cutover = new api.PackageCutover();
      const plan = await cutover.plan(root);
      process.stdout.write(`${JSON.stringify({
        changed: plan.changed,
        capabilities: plan.capabilities,
        entry: relative(root, plan.entryFile),
        dependencies: plan.dependencies,
      }, null, 2)}\n`);
      if (options.write) await cutover.apply(plan);
      return;
    }
    if (phase !== 'extract') throw new Error('migrate phase must be extract, cutover, or status');
    const migrator = new api.LegacyCapabilityMigrator();
    const plan = await migrator.plan(root);
    const summary = migrator.summarize(plan);
    process.stdout.write(`${JSON.stringify({
      summary,
      changes: plan.changes.map((change) => ({
        ...change,
        content: undefined,
        source: relative(root, change.source),
        target: relative(root, change.target),
      })),
      diagnostics: plan.diagnostics.map((item) => ({
        ...item,
        source: relative(root, item.source),
      })),
    }, null, 2)}\n`);
    if (options.write) await migrator.apply(plan);
    if (summary.errors > 0) process.exitCode = 1;
  });

runtimeCommand.command('build')
  .action(async () => {
    const commands = new ProjectCommands();
    await commands.execute(commands.buildPlan(await commands.inspect(process.cwd())), new NodeProcessRunner());
  });

runtimeCommand.command('publish')
  .option('--execute', '执行发布事务')
  .option('--resume', '恢复未完成的发布事务')
  .option('--tag <tag>', '目标 dist-tag', 'latest')
  .action(async (options) => {
    const root = resolve(process.cwd());
    const commands = new ProjectCommands();
    const plan = commands.publishPlan(await commands.inspect(root), {
      execute: options.execute || options.resume,
      tag: options.tag,
    });
    const runner = new NodeProcessRunner();
    if (plan.mode === 'execute') {
      await commands.executePublish(
        plan,
        runner,
        new FilePublishJournalStore(join(root, '.zhin/publish-journal.json')),
        { resume: options.resume },
      );
    } else await commands.execute(plan, runner);
  });
