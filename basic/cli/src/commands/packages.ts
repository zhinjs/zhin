import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
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
  readInstalledZhinField,
  registerPluginInManifest,
  resolveInstallRoute,
  type ResolvedInstall,
} from '../utils/plugin-registry.js';
import {
  buildInstallArgs,
  enablePluginInProjectConfig,
} from './install.js';
import { runPluginInfo, runPluginSearch } from './search.js';
import { logger } from '../utils/logger.js';

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

    await installNpmPlugin(resolved, opts);
  });

/**
 * a/b) npm 插件安装：pnpm add → 判定是否 zhin 插件 → 启用配置 + 注册 zhin.plugins 清单
 */
async function installNpmPlugin(resolved: ResolvedInstall, opts: InstallOptions) {
  const cwd = process.cwd();
  const pkg = resolved.package;
  const installArgs = buildInstallArgs(pkg, 'npm', {});
  const shouldEnable = opts.enable !== false;

  if (opts.dryRun) {
    logger.log('🧪 dry-run：不会安装依赖，也不会修改配置。');
    logger.log(`将执行: pnpm ${installArgs.join(' ')}`);
    if (shouldEnable) {
      logger.log(`将挂载: package.json 的 zhin.plugins 清单添加 ${pkg}`);
    }
    return;
  }

  try {
    execFileSync('pnpm', installArgs, { cwd, stdio: 'inherit' });
  } catch (error) {
    logger.error('安装失败');
    throw error;
  }
  logger.success(`✓ ${pkg} 安装成功！`);
  logger.log('');

  // 判定插件身份：命中已知适配器，或已安装包的 package.json 带 zhin 字段
  const zhinField = readInstalledZhinField(cwd, pkg);
  const isZhinPlugin = resolved.route === 'adapter' || zhinField !== null;

  if (!isZhinPlugin) {
    logger.log('ℹ️ 该包不含 zhin 字段，已作为普通依赖安装（不会挂载到 Plugin Runtime）。');
    return;
  }

  if (shouldEnable) {
    const enableResult = await enablePluginInProjectConfig(cwd, pkg);
    logger.log(`🔌 ${enableResult.message}`);
    const manifestMerged = await registerPluginInManifest(cwd, pkg);
    if (manifestMerged) {
      logger.log(`🧩 已在 package.json 的 zhin.plugins 清单中挂载 ${pkg}`);
    }
  } else {
    logger.log('🔌 未自动启用插件。可手动添加到 zhin.config.yml:');
    logger.log('plugins:');
    logger.log(`  - "${pkg}"`);
  }

  // a) 已知适配器：提示完成凭据配置
  const hint = adapterConfigHintForPackage(pkg);
  if (hint) {
    logger.log('');
    logger.log(`🧭 适配器下一步：${hint}`);
    if (resolved.adapter?.setupHint) {
      logger.log(`   ${resolved.adapter.setupHint}`);
    }
  }

  logger.log('');
  logger.log('下一步：');
  logger.log('  pnpm dev');
  logger.log('  zhin doctor');
}

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
