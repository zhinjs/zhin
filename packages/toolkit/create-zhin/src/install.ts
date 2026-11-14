import { wizardText } from '@zhin.js/scaffold-wizard';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';

export async function ensurePnpmInstalled(locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    console.log(chalk.green(wizardText(locale, "✓ 检测到 pnpm 已安装")));
  } catch (error) {
    console.log(chalk.yellow(wizardText(locale, "⚠ 未检测到 pnpm，正在自动安装...")));
    try {
      console.log(chalk.blue(wizardText(locale, "正在执行: npm install -g pnpm")));
      execSync('npm install -g pnpm', { stdio: 'inherit' });
      console.log(chalk.green(wizardText(locale, "✓ pnpm 安装成功！")));
    } catch (installError) {
      const errorMessage = installError instanceof Error ? installError.message : String(installError);
      console.error(chalk.red(wizardText(locale, "✗ pnpm 安装失败，请手动安装:")));
      if (process.env.DEBUG) {
        console.error(chalk.gray(wizardText(locale, "错误详情: {v0}", [errorMessage])));
      }
      console.log(chalk.cyan('  npm install -g pnpm'));
      console.log(chalk.gray(wizardText(locale, "或访问: https://pnpm.io/installation")));
      process.exit(1);
    }
  }
}

/** pnpm 11 writes this placeholder into `allowBuilds` for every dependency whose build script it ignored. */
const ALLOW_BUILDS_PLACEHOLDER = /^\s+([@\w./-]+):\s*set this to true or false\s*$/gmu;

/** Dependencies pnpm left as `allowBuilds.<name>: set this to true or false` (it ignored their build scripts). */
export function findIgnoredBuildPlaceholders(projectPath: string): string[] {
  const file = path.join(projectPath, 'pnpm-workspace.yaml');
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, 'utf8').matchAll(ALLOW_BUILDS_PLACEHOLDER)].map(match => match[1]!.replace(/^['"]|['"]$/gu, ''));
}

/** Every dependency declared in the project's package.json is present in its node_modules. */
export function areDeclaredDependenciesInstalled(projectPath: string): boolean {
  try {
    const pkg = fs.readJsonSync(path.join(projectPath, 'package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (names.length === 0 || !fs.existsSync(path.join(projectPath, 'node_modules'))) return false;
    return names.every(name => fs.existsSync(path.join(projectPath, 'node_modules', name, 'package.json')));
  } catch {
    return false;
  }
}

/**
 * `ok`: pnpm install succeeded. `partial`: pnpm exited non-zero but every declared dependency is in
 * node_modules (pnpm 11 fails an install whose dependency build scripts it ignored, after installing
 * them): the project is usable, so creation goes on with a precise warning instead of failing.
 */
export type InstallOutcome = 'ok' | 'partial';

export async function installDependencies(
  projectPath: string,
  locale: 'zh-CN' | 'en' = 'zh-CN',
  run: (command: string, cwd: string) => void = (command, cwd) => { execSync(command, { cwd, stdio: 'inherit' }); },
): Promise<InstallOutcome> {
  try {
    console.log(chalk.gray(wizardText(locale, "执行: pnpm install")));
    run('pnpm install', projectPath);
    console.log(chalk.green(wizardText(locale, "✓ 依赖安装成功！")));
    return 'ok';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log('');
    if (areDeclaredDependenciesInstalled(projectPath)) {
      const ignored = findIgnoredBuildPlaceholders(projectPath);
      console.log(chalk.yellow(wizardText(locale, "⚠ pnpm install 以非零状态退出，但项目依赖已全部安装，创建继续。")));
      if (ignored.length > 0) {
        console.log(chalk.yellow(wizardText(locale, "  原因：pnpm 跳过了这些依赖的构建脚本：{v0}（ERR_PNPM_IGNORED_BUILDS）。Console 终端需要 node-pty 的原生模块。", [ignored.join(', ')])));
        console.log(chalk.gray(wizardText(locale, "  修复：在 pnpm-workspace.yaml 的 allowBuilds 中把它们设为 true，然后运行：")));
      } else {
        console.log(chalk.gray(wizardText(locale, "  上方是 pnpm 的输出；修复后在项目目录重新运行：")));
      }
      console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
      console.log(chalk.cyan('  pnpm install'));
      if (process.env.DEBUG) {
        console.log(chalk.gray(wizardText(locale, "错误详情: {v0}", [errorMessage])));
      }
      return 'partial';
    }
    console.log(chalk.yellow(wizardText(locale, "⚠ 依赖安装失败")));
    if (process.env.DEBUG) {
      console.log(chalk.gray(wizardText(locale, "错误详情: {v0}", [errorMessage])));
    }
    console.log(chalk.gray(wizardText(locale, "你可以稍后手动安装:")));
    console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
    console.log(chalk.cyan('  pnpm install'));
    throw new Error(`pnpm install failed: ${errorMessage}`);
  }
}

/**
 * 安装后自检：复用项目内刚装好的 @zhin.js/cli 的 `zhin doctor`
 *（Node 版本 / pnpm / 配置 / Console 登录条件 / 端口占用，彩色 ✅/⚠️/❌ 输出）。
 * 自检失败（含 doctor 检出 error 的退出码）不阻断创建流程。
 */
export async function runPostInstallDoctor(projectPath: string, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> {
  console.log(chalk.blue(wizardText(locale, "🩺 安装后自检（zhin doctor）...")));
  console.log('');
  try {
    execSync('pnpm exec zhin doctor', {
      cwd: projectPath,
      stdio: 'inherit'
    });
  } catch {
    console.log('');
    console.log(chalk.yellow(wizardText(locale, "⚠ 自检发现问题（见上方 ❌/⚠️），可按提示修复后重新运行:")));
    console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
    console.log(chalk.cyan('  pnpm exec zhin doctor'));
  }
}