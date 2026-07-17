import { join, relative, resolve } from 'node:path';
import { Command } from 'commander';
import { FilePublishJournalStore } from '../plugin-runtime/publish-journal.js';
import { NodeProcessRunner, ProjectCommands } from '../plugin-runtime/project-commands.js';
import { ProjectScaffolder } from '../plugin-runtime/scaffolder.js';

export const runtimeCommand = new Command('runtime')
  .description('管理约定式 Plugin Runtime 项目');

runtimeCommand.command('init [package-name]')
  .action(async (packageName = 'zhin-plugin') => {
    await new ProjectScaffolder(process.cwd()).init({ packageName });
  });

runtimeCommand.command('create <kind> <name> [package-name]')
  .action(async (kind, name, packageName) => {
    const scaffold = new ProjectScaffolder(process.cwd());
    if (kind === 'plugin') await scaffold.createPlugin({ name, packageName });
    else if (kind === 'feature') await scaffold.createFeature({ name, packageName });
    else throw new Error('runtime create kind must be plugin or feature');
  });

runtimeCommand.command('inspect')
  .action(async () => {
    const commands = new ProjectCommands();
    process.stdout.write(`${JSON.stringify(commands.describe(
      await commands.inspect(process.cwd()),
    ), null, 2)}\n`);
  });

runtimeCommand.command('start')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_options, command) => {
    const { runStartCommand } = await import('../plugin-runtime/start-command.js');
    await runStartCommand({
      root: resolve(process.cwd()),
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
