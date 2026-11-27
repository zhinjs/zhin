import { writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Command } from 'commander';
import { FilePublishJournalStore } from '../plugin-runtime/publish-journal.js';
import { NodeProcessRunner, ProjectCommands } from '../plugin-runtime/project-commands.js';
import { isSupervisedInstanceProcess } from '@zhin.js/gateway/supervisor';
import { runGateway } from '@zhin.js/gateway/server';
import {
  createConfigDocument,
  findConfigFile,
  formatStartOptionHelp,
  generatePluginCapabilityCodegen,
  parseStartOptions,
  readApplicationPluginDeclaration,
} from '@zhin.js/runtime';
import { runProjectInstance } from './runtime-instance.js';
import { output } from '../utils/output.js';
import { requireProjectRoot } from '../utils/project-root.js';
import {
  describeBuildPlan,
  describePublishPlan,
  formatBuildPlan,
  formatInspectSummary,
  formatPublishPlan,
  summarizeProjectGraph,
  type DeclaredInstance,
} from '../plugin-runtime/project-report.js';

export const runtimeCommand = new Command('runtime')
  .description('管理约定式 Plugin Runtime 项目：作用于整个项目 / workspace（单个插件用 zhin build / zhin pub）')
  .addHelpText('after', `
作用范围:
  runtime inspect / migrate / build / publish 作用于当前项目（整个 pnpm workspace，按依赖顺序处理）；
  zhin build / zhin pub 只处理一个插件包（当前目录或指定的插件）。
  runtime start 等同于 zhin start --foreground。`);

/** `zhin.config.yml` instances, disabled ones included (the graph only holds enabled ones). */
async function declaredInstances(root: string): Promise<readonly DeclaredInstance[]> {
  const file = findConfigFile(root);
  if (!file) return [];
  const { document } = await createConfigDocument(join(root, file)).read();
  return readApplicationPluginDeclaration(document as Record<string, unknown>).instances;
}

runtimeCommand.command('inspect')
  .description('查看当前项目的插件实例表（实例、包、来源、启用状态、features 数）；--json 输出完整插件图')
  .option('--json', '输出完整结构（根插件、各实例的 features 与子插件、构建顺序、已停用实例）', false)
  .action(async (options: { json?: boolean }) => {
    const root = resolve(process.cwd());
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const summary = summarizeProjectGraph(graph, await declaredInstances(root));
    if (options.json) {
      output.json({
        ...(commands.describe(graph) as Record<string, unknown>),
        disabled: summary.instances.filter((item) => !item.enabled).map((item) => ({ instanceKey: item.instanceKey, package: item.package })),
      });
      return;
    }
    output.line(...formatInspectSummary(summary));
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
  .description('前台运行管理网关与实例（同 zhin start --foreground）；选项见下方 Start options')
  .usage('[options]')
  .addHelpText('after', formatStartOptionHelp())
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_options, command) => {
    // Process supervision belongs to the executable, not the reusable startup API.
    // #1250: nothing (no `.zhin/`, no port) outside a project root.
    const project = isSupervisedInstanceProcess() ? undefined : requireProjectRoot(process.cwd(), { command: ['zhin', 'runtime', 'start', ...command.args] });
    if (project && !project.ok) {
      process.stderr.write(`zhin: ${project.message}\n`);
      process.exitCode = 1;
      return;
    }
    const root = resolve(process.cwd());
    const parsed = parseStartOptions(command.args);
    if (!isSupervisedInstanceProcess() && !parsed.standalone) {
      // Parent: the long-lived gateway (HTTP server on `http.port`, local control socket,
      // supervisor) spawns this command again as the instance and forwards HTTP to it over the
      // control channel (ADR 0054 §1 / §3). `--daemon` only marks a background run.
      const instanceArgs = command.args.filter((argument: string) => argument !== '--daemon' && argument !== '-d');
      process.exitCode = await runGateway({ root, options: parsed, args: ['runtime', 'start', ...instanceArgs] });
      return;
    }
    // The supervised instance child normally takes the fast path in `cli.ts`; this covers
    // `--standalone` and any other way of reaching the command.
    await runProjectInstance(command.args);
  });

runtimeCommand.command('migrate [phase]')
  .description('把当前项目的旧式插件迁移到约定目录（作用于当前项目根）；phase: extract（默认，提取能力）| cutover（切换入口与依赖）| verify（构建并打包验证）| status（迁移就绪度）；输出 JSON')
  .option('--check', '只生成迁移计划，不写文件（extract / cutover 必须二选一 --check 或 --write）')
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
    if (phase === 'verify') {
      // Builds (and for public packages packs) the cut-over project; needs neither --check nor --write.
      const report = await new api.MigrationVerifier().verify(root);
      process.stdout.write(`${JSON.stringify({
        mode: report.mode,
        commands: report.commands,
        tarballEntries: report.tarballEntries,
      }, null, 2)}\n`);
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
    if (phase !== 'extract') throw new Error('migrate phase must be extract, cutover, verify, or status');
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
  .description('按依赖顺序构建整个 workspace 中带 build 脚本的包（pnpm run build）；构建单个插件用 zhin build')
  .option('--json', '只输出构建计划（JSON，含 empty 字段），不执行构建', false)
  .action(async (options: { json?: boolean }) => {
    const root = resolve(process.cwd());
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const plan = commands.buildPlan(graph);
    const report = describeBuildPlan(root, graph, plan);
    if (options.json) {
      output.json(report);
      return;
    }
    output.line(...formatBuildPlan(report));
    // Nothing to build is a valid state (no package has a build script): exit 0, said explicitly.
    if (report.empty) return;
    await commands.execute(plan, new NodeProcessRunner());
  });

runtimeCommand.command('publish')
  .description('发布整个 workspace 中所有非 private 的包；默认 dry-run，只打印计划并运行 pnpm publish --dry-run。发布单个插件用 zhin pub')
  .option('--execute', '真正发布：把计划中的全部非 private workspace 包一次性发到 npm（需要 npm 登录）。先用临时 dist-tag 发布，全部成功后改到 --tag，再移除临时 tag；进度写入 .zhin/publish-journal.json，中途失败用 --resume 继续')
  .option('--resume', '从 .zhin/publish-journal.json 继续上次中断的发布（隐含 --execute）：已完成的步骤先向 npm 核对再跳过，不会重复发布')
  .option('--tag <tag>', '目标 dist-tag', 'latest')
  .option('--json', '只输出发布计划（JSON，含 empty 与跳过的 private 包），不运行任何 pnpm 命令；不能与 --execute / --resume 同用', false)
  .addHelpText('after', `
退出码:
  dry-run（含 --json）计划为空（全部包都是 private）时退出码为 0：这是正确的检查结果，输出会写明原因，--json 带 empty: true；
  --execute / --resume 计划为空时退出码为 1：要求发布却没有任何包发出，脚本应当察觉。`)
  .action(async (options: { execute?: boolean; resume?: boolean; tag: string; json?: boolean }) => {
    if (options.json && (options.execute || options.resume)) {
      throw new Error('--json 只输出发布计划，不能与 --execute / --resume 同用');
    }
    const root = resolve(process.cwd());
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const plan = commands.publishPlan(graph, {
      execute: options.execute || options.resume,
      tag: options.tag,
    });
    const report = describePublishPlan(root, graph, plan);
    if (options.json) {
      output.json(report);
      return;
    }
    output.line(...formatPublishPlan(report));
    if (report.empty) {
      if (report.mode === 'execute') process.exitCode = 1;
      return;
    }
    output.line();
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
