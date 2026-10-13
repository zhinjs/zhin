import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import {
  installZhinPackage,
  listZhinPackageSkillRoots,
  readLock,
  removeZhinPackage,
  resolvePackagesRoot,
} from '../utils/zhin-packages.js';
import {
  adapterConfigHintForPackage,
  resolveInstallRoute,
  type ResolvedInstall,
} from '../utils/plugin-registry.js';
import {
  buildInstallArgs,
} from './install.js';
import { runPluginInfo, runPluginSearch } from './search.js';
import { logger } from '../utils/logger.js';
import { PluginManagementWorkflow } from '../plugin-management/workflow.js';
import { requestPluginConsole } from '../plugin-management/console-client.js';
import { PLUGIN_RPC } from '@zhin.js/console-protocol';

const packagesCommand = new Command('packages')
  .description('插件生态入口：搜索/查看/安装插件与 zhin-package 技能包（ADR 0010）');

packagesCommand
  .command('search [keyword]')
  .description('搜索 Zhin.js 插件（npm registry）')
  .option('-c, --category <category>', '按分类搜索 (utility|service|game|adapter|admin|ai)')
  .option('-l, --limit <number>', '限制结果数量', '20')
  .option('--official', '仅显示官方插件', false)
  .action((keyword: string | undefined, options: { category?: string; limit?: number; official?: boolean }) =>
    runPluginSearch(keyword, options));

packagesCommand
  .command('info <name>')
  .description('查看插件详情（版本/描述/周下载量/依赖/homepage；官方适配器附配置入口）')
  .action((name: string) => runPluginInfo(name));

interface InstallOptions {
  local?: boolean;
  enable?: boolean;
  dryRun?: boolean;
}

packagesCommand
  .command('install <source>')
  .description('安装包：npm 插件/适配器，或 npm:/git: 前缀的 zhin-package 技能包')
  .option('-l, --local', '技能包安装到项目 .zhin/packages/')
  .option('--no-enable', '只安装依赖，不自动写入 zhin.config 与 zhin.plugins 清单')
  .option('--dry-run', '打印将要执行的安装和配置改动，不写入文件')
  .action(async (source: string, opts: InstallOptions) => {
    const resolved = resolveInstallRoute(source);
    logger.info(formatCompact({ cmd: 'packages', op: 'install', route: resolved.route, package: resolved.package }));

    if (resolved.route === 'skill-pack') {
      // c) npm:/git: 前缀 → ADR 0010 技能包路径（现状不变）
      const target = installZhinPackage(source, { local: opts.local });
      console.log(`✅ 已安装到 ${target}`);
      const roots = listZhinPackageSkillRoots();
      if (roots.length > 0) {
        console.log('技能目录:');
        for (const r of roots) console.log(`  - ${r}`);
      }
      return;
    }

    await installNpmPlugin(resolved, opts, source);
  });

/**
 * a/b) npm 插件安装：pnpm add → 判定是否 zhin 插件 → 启用配置 + 注册 zhin.plugins 清单
 */
export async function installNpmPlugin(resolved: ResolvedInstall, opts: InstallOptions, source = resolved.package) {
  const cwd = process.cwd();
  const workflow = new PluginManagementWorkflow(cwd);
  if (opts.dryRun) {
    logger.log('🧪 dry-run：不会安装依赖，也不会修改配置。');
    logger.log(`将执行: pnpm ${buildInstallArgs(source, 'npm', {}).join(' ')}`);
    logger.log(JSON.stringify(await workflow.planInstall(source), null, 2));
    return;
  }
  const result = await workflow.install(source, undefined, undefined, { enable: opts.enable });
  logger.success(`✓ ${result.state.packageName}@${result.state.version ?? 'unknown'} 依赖安装完成`);
  logger.log(`插件状态: ${result.state.status}；功能验证: ${result.state.verification}`);
  if (result.restartRequired) logger.log('配置就绪后启动/重启 Host，再检查当前 generation。');
  const hint = adapterConfigHintForPackage(resolved.package);
  if (hint) logger.log(hint);
}

interface LiveOptions { live?: string; tokenEnv?: string }

packagesCommand
  .command('status <name>')
  .description('查看安装、声明、配置、当前 generation 与验证证据')
  .option('--live <host-url>', '从运行中的 Host 读取当前 generation；省略时仅检查本地文件')
  .option('--token-env <name>', 'Console token 所在环境变量', 'ZHIN_CONSOLE_TOKEN')
  .action(async (name: string, options: LiveOptions) => {
    const state = options.live
      ? await requestPluginConsole(options.live, { type: PLUGIN_RPC.INSPECT, instanceKey: name }, options.tokenEnv)
      : await new PluginManagementWorkflow(process.cwd()).inspect(name);
    console.log(JSON.stringify(state, null, 2));
  });

packagesCommand
  .command('apply <name>')
  .description('请求运行中的 Host 应用配置；返回申请结果，随后用 status 检查是否真正发布')
  .requiredOption('--live <host-url>', '运行中的 Host URL')
  .requiredOption('--project-revision <revision>', 'status/plan 返回的项目 revision')
  .option('--token-env <name>', 'Console token 所在环境变量', 'ZHIN_CONSOLE_TOKEN')
  .action(async (name: string, options: LiveOptions & { projectRevision: string }) => {
    console.log(JSON.stringify(await requestPluginConsole(options.live!, { type: PLUGIN_RPC.APPLY, instanceKey: name, expectedProjectRevision: options.projectRevision }, options.tokenEnv), null, 2));
  });

packagesCommand
  .command('verification-plan <name>')
  .description('列出业务检查及副作用，不执行；离线时明确报告未配置验证')
  .option('--live <host-url>', '运行中的 Host URL')
  .option('--token-env <name>', 'Console token 所在环境变量', 'ZHIN_CONSOLE_TOKEN')
  .action(async (name: string, options: LiveOptions) => {
    const plan = options.live
      ? await requestPluginConsole(options.live, { type: PLUGIN_RPC.PLAN_VERIFICATION, instanceKey: name }, options.tokenEnv)
      : await new PluginManagementWorkflow(process.cwd()).verificationPlan(name);
    console.log(JSON.stringify(plan, null, 2));
  });

packagesCommand
  .command('verify <name> <check-id>')
  .description('执行已查看副作用的精确业务检查；运行期变更会拒绝旧计划')
  .requiredOption('--live <host-url>', '运行中的 Host URL')
  .requiredOption('--generation <number>', '验证计划的 generation')
  .requiredOption('--project-revision <revision>', '验证计划的项目 revision')
  .requiredOption('--check-revision <revision>', '验证计划的检查摘要')
  .option('--token-env <name>', 'Console token 所在环境变量', 'ZHIN_CONSOLE_TOKEN')
  .action(async (name: string, checkId: string, options: LiveOptions & { generation: string; projectRevision: string; checkRevision: string }) => {
    const expectedGeneration = Number(options.generation);
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) throw new Error('generation must be a nonnegative integer');
    console.log(JSON.stringify(await requestPluginConsole(options.live!, { type: PLUGIN_RPC.VERIFY, instanceKey: name, checkId, expectedGeneration, expectedProjectRevision: options.projectRevision, expectedCheckRevision: options.checkRevision }, options.tokenEnv), null, 2));
  });

packagesCommand
  .command('remove <name>')
  .description('移除已安装包')
  .option('-l, --local', '从项目 .zhin/packages/ 移除')
  .action((name: string, opts: { local?: boolean }) => {
    const ok = removeZhinPackage(name, { local: opts.local });
    console.log(ok ? `✅ 已移除 ${name}` : `ℹ️ 未找到 ${name}`);
  });

packagesCommand
  .command('list')
  .description('列出已安装包')
  .option('-l, --local', '仅项目本地')
  .action((opts: { local?: boolean }) => {
    const roots = opts.local
      ? [resolvePackagesRoot(true)]
      : [resolvePackagesRoot(false), resolvePackagesRoot(true)];
    const seen = new Set<string>();
    for (const root of roots) {
      const lock = readLock(root);
      for (const pkg of lock.packages) {
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);
        console.log(`${pkg.name}  ←  ${pkg.source}  (${pkg.local ? 'local' : 'global'})`);
      }
    }
    if (seen.size === 0) console.log('（无已安装 zhin-package）');
  });

packagesCommand
  .command('update [source]')
  .description('更新包（重新 install）')
  .option('-l, --local', '项目本地')
  .action((source: string | undefined, opts: { local?: boolean }) => {
    const root = resolvePackagesRoot(!!opts.local);
    const lock = readLock(root);
    const targets = source
      ? lock.packages.filter(p => p.name === source || p.source === source)
      : lock.packages;
    if (targets.length === 0) {
      console.log('ℹ️ 无匹配包');
      return;
    }
    for (const pkg of targets) {
      removeZhinPackage(pkg.name, { local: pkg.local });
      installZhinPackage(pkg.source, { local: pkg.local });
      console.log(`✅ 已更新 ${pkg.name}`);
    }
  });

export { packagesCommand };
