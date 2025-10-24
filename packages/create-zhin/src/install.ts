import { execSync } from 'node:child_process';
import chalk from 'chalk';
import path from 'path';

export async function ensurePnpmInstalled() {
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
      console.error(chalk.red('✗ pnpm 安装失败，请手动安装:'));
      console.log(chalk.cyan('  npm install -g pnpm'));
      console.log(chalk.gray('或访问: https://pnpm.io/installation'));
      process.exit(1);
    }
  }
}

export async function installDependencies(projectPath: string) {
  try {
    console.log(chalk.gray('执行: pnpm install'));
    execSync('pnpm install', {
      cwd: projectPath,
      stdio: 'inherit'
    });
    console.log(chalk.green('✓ 依赖安装成功！'));
  } catch (error) {
    console.log('');
    console.log(chalk.yellow('⚠ 依赖安装失败'));
    console.log(chalk.gray('你可以稍后手动安装:'));
    console.log(chalk.cyan(`  cd ${path.basename(projectPath)}`));
    console.log(chalk.cyan('  pnpm install'));
  }
}