/**
 * migrate — 将老版本 Zhin 项目快速升级到最新
 *
 * - 升级 package.json 中 zhin.js 与所有 @zhin.js/* 依赖为 latest
 * - 补全缺失的推荐 scripts、engines
 * - 确保 data、plugins 等目录存在
 * - 执行 pnpm install
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

const cwd = process.cwd();

const ZHIN_PACKAGE_PREFIX = '@zhin.js/';
const CORE_PACKAGE = 'zhin.js';

const RECOMMENDED_SCRIPTS: Record<string, string> = {
  dev: 'zhin dev',
  start: 'zhin start',
  daemon: 'zhin start --daemon',
  stop: 'zhin stop',
  build: 'tsc && zhin-console build',
};

function isZhinProject(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = fs.readJsonSync(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return CORE_PACKAGE in deps || 'zhin' in deps;
  } catch {
    return false;
  }
}

function isWorkspaceProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'));
}

function collectZhinDeps(pkg: any): { dep: string; current: string; inDev: boolean }[] {
  const out: { dep: string; current: string; inDev: boolean }[] = [];
  const add = (name: string, version: string, inDev: boolean) => {
    if (name === CORE_PACKAGE || name.startsWith(ZHIN_PACKAGE_PREFIX)) {
      out.push({ dep: name, current: version, inDev });
    }
  };
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    add(name, version as string, false);
  }
  for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
    add(name, version as string, true);
  }
  return out;
}

function upgradePackageJson(pkgPath: string, options: { toLatest: boolean; dryRun: boolean }): boolean {
  const pkg = fs.readJsonSync(pkgPath);
  const isWorkspace = isWorkspaceProject(path.dirname(pkgPath));

  const zhinDeps = collectZhinDeps(pkg);
  if (zhinDeps.length === 0) {
    logger.warn('未在 package.json 中发现 zhin.js 或 @zhin.js/* 依赖');
    return false;
  }

  let changed = false;
  const targetVersion = options.toLatest ? 'latest' : 'latest';

  for (const { dep, current, inDev } of zhinDeps) {
    const key = inDev ? 'devDependencies' : 'dependencies';
    const existing = pkg[key]?.[dep];
    if (existing === undefined) continue;
    // 保留 workspace 协议（monorepo 内不改为 latest）
    if (isWorkspace && (existing === 'workspace:*' || String(existing).startsWith('workspace:'))) {
      continue;
    }
    if (existing === targetVersion) continue;
    if (options.dryRun) {
      console.log(chalk.cyan(`  [dry-run] ${dep}: ${existing} → ${targetVersion}`));
    } else {
      pkg[key][dep] = targetVersion;
    }
    changed = true;
  }

  // 补全推荐 scripts（缺失则添加）
  if (!pkg.scripts) pkg.scripts = {};
  for (const [name, cmd] of Object.entries(RECOMMENDED_SCRIPTS)) {
    if (!pkg.scripts[name]) {
      if (options.dryRun) {
        console.log(chalk.cyan(`  [dry-run] scripts.${name} = "${cmd}"`));
      } else {
        pkg.scripts[name] = cmd;
      }
      changed = true;
    }
  }

  // 确保 engines.node
  if (!pkg.engines?.node) {
    if (options.dryRun) {
      console.log(chalk.cyan('  [dry-run] engines.node = ">=18.0.0"'));
    } else {
      pkg.engines = pkg.engines || {};
      pkg.engines.node = '>=18.0.0';
    }
    changed = true;
  }

  if (changed && !options.dryRun) {
    fs.writeJsonSync(pkgPath, pkg, { spaces: 2 });
  }
  return changed;
}

function ensureDirs(dir: string, dryRun: boolean): void {
  const dirs = ['data', 'plugins', 'src/plugins'];
  for (const d of dirs) {
    const full = path.join(dir, d);
    if (fs.existsSync(full)) continue;
    if (dryRun) {
      console.log(chalk.cyan(`  [dry-run] mkdir ${d}`));
    } else {
      fs.ensureDirSync(full);
      console.log(chalk.green(`  ✓ 确保目录 ${d}`));
    }
  }
}

function runInstall(dir: string, dryRun: boolean): boolean {
  const hasPnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'));
  const hasNpm = fs.existsSync(path.join(dir, 'package-lock.json'));
  const cmd = hasPnpm ? 'pnpm install' : hasNpm ? 'npm install' : 'pnpm install';
  if (dryRun) {
    console.log(chalk.cyan(`  [dry-run] ${cmd}`));
    return true;
  }
  try {
    execSync(cmd, { cwd: dir, stdio: 'inherit' });
    return true;
  } catch {
    logger.error(`执行 ${cmd} 失败，请手动在项目目录执行`);
    return false;
  }
}

export const migrateCommand = new Command('migrate')
  .description('将老版本 Zhin 项目快速升级到最新（依赖、scripts、目录结构）')
  .option('--dry-run', '仅打印将要执行的操作，不写入文件也不安装依赖', false)
  .option('--no-install', '跳过最后一步 pnpm install', false)
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.cyan('  Zhin 项目升级 (migrate)'));
    console.log('');

    if (!isZhinProject(cwd)) {
      logger.error('当前目录不是 Zhin 项目（package.json 中未找到 zhin.js 依赖）');
      process.exit(1);
    }

    const pkgPath = path.join(cwd, 'package.json');
    const dryRun = !!options.dryRun;
    const runInstallAfter = options.install !== false;

    if (dryRun) {
      console.log(chalk.yellow('  [dry-run 模式] 以下变更不会实际写入'));
      console.log('');
    }

    // 1. 升级 package.json
    console.log(chalk.bold.blue('1. 升级依赖与 scripts'));
    const pkgChanged = upgradePackageJson(pkgPath, { toLatest: true, dryRun });
    if (pkgChanged && !dryRun) {
      console.log(chalk.green('  ✓ package.json 已更新'));
    } else if (dryRun && collectZhinDeps(fs.readJsonSync(pkgPath)).length > 0) {
      console.log(chalk.gray('  (见上方 [dry-run] 变更)'));
    }
    console.log('');

    // 2. 确保目录
    console.log(chalk.bold.blue('2. 确保目录结构'));
    ensureDirs(cwd, dryRun);
    console.log('');

    // 3. 安装依赖
    if (runInstallAfter) {
      console.log(chalk.bold.blue('3. 安装依赖'));
      const ok = runInstall(cwd, dryRun);
      if (!ok && !dryRun) {
        process.exitCode = 1;
        return;
      }
      console.log('');
    }

    console.log(chalk.bold.green('✅ 升级完成'));
    console.log('');
    console.log(chalk.gray('建议：'));
    console.log(chalk.cyan('  zhin doctor') + chalk.gray('  检查项目健康'));
    console.log(chalk.cyan('  pnpm dev') + chalk.gray('   试运行'));
    console.log('');
  });
