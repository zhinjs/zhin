import { execSync } from 'node:child_process';
import chalk from 'chalk';
import path from 'path';

export async function ensurePnpmInstalled(): Promise<void> {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    console.log(chalk.green('✓ 检测到 pnpm 已安装'));
  } catch (error) {
    console.log(chalk.yellow('⚠ 未检测到 pnpm，正在自动安装...'));
    try {
      console.log(chalk.blue('正在执行: npm install -g pnpm'));
      execSync('npm install -g pnpm', { stdio: 'inherit' });
      console.log(chalk.green('✓ pnpm 安装成功！'));
    } catch (installError) {
      const errorMessage = installError instanceof Error ? installError.message : String(installError);
      console.error(chalk.red('✗ pnpm 安装失败，请手动安装:'));
      if (process.env.DEBUG) {
        console.error(chalk.gray(`错误详情: ${errorMessage}`));
      }
      console.log(chalk.cyan('  npm install -g pnpm'));
      console.log(chalk.gray('或访问: https://pnpm.io/installation'));
      process.exit(1);
    }
  }
}

export async function installDependencies(projectPath: string): Promise<void> {
  try {
    console.log(chalk.gray('执行: pnpm install'));
    execSync('pnpm install', {
      cwd: projectPath,
      stdio: 'inherit'
    });
    console.log(chalk.green('✓ 依赖安装成功！'));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log('');
    console.log(chalk.yellow('⚠ 依赖安装失败'));
    if (process.env.DEBUG) {
      console.log(chalk.gray(`错误详情: ${errorMessage}`));
    }
    console.log(chalk.gray('你可以稍后手动安装:'));
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
export async function runPostInstallDoctor(projectPath: string): Promise<void> {
  console.log(chalk.blue('🩺 安装后自检（zhin doctor）...'));
  console.log('');
  try {
    execSync('pnpm exec zhin doctor', {
      cwd: projectPath,
      stdio: 'inherit'
    });
  } catch {
    console.log('');
    console.log(chalk.yellow('⚠ 自检发现问题（见上方 ❌/⚠️），可按提示修复后重新运行:'));
    console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
    console.log(chalk.cyan('  pnpm exec zhin doctor'));
  }
}