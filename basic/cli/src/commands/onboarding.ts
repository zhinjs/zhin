import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

function checkEnvironment(): { node: boolean; pnpm: boolean; git: boolean } {
  const checks = {
    node: false,
    pnpm: false,
    git: false
  };

  try {
    const nodeVersion = execSync('node -v', { encoding: 'utf-8' }).trim();
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    checks.node = major >= 18;
  } catch {}

  try {
    execSync('pnpm -v', { encoding: 'utf-8' });
    checks.pnpm = true;
  } catch {}

  try {
    execSync('git --version', { encoding: 'utf-8' });
    checks.git = true;
  } catch {}

  return checks;
}

function printWelcome(): void {
  console.log('');
  console.log(chalk.bold.cyan('  ╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║                                                               ║'));
  console.log(chalk.bold.cyan('  ║') + chalk.bold.white('          欢迎来到 Zhin.js - 现代化机器人框架              ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('  ║                                                               ║'));
  console.log(chalk.bold.cyan('  ╚═══════════════════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray('  让我们开始构建你的第一个机器人吧！🚀'));
  console.log('');
}

function printEnvironmentCheck(checks: { node: boolean; pnpm: boolean; git: boolean }): void {
  console.log(chalk.bold.blue('📋 环境检查'));
  console.log('');
  
  if (checks.node) {
    console.log(chalk.green('  ✓ Node.js (>= 18.0)'));
  } else {
    console.log(chalk.red('  ✗ Node.js (需要 >= 18.0)'));
    console.log(chalk.gray('    安装: https://nodejs.org/'));
  }
  
  if (checks.pnpm) {
    console.log(chalk.green('  ✓ pnpm'));
  } else {
    console.log(chalk.red('  ✗ pnpm (推荐的包管理器)'));
    console.log(chalk.gray('    安装: npm install -g pnpm'));
  }
  
  if (checks.git) {
    console.log(chalk.green('  ✓ Git'));
  } else {
    console.log(chalk.yellow('  ○ Git (可选，但推荐安装)'));
    console.log(chalk.gray('    安装: https://git-scm.com/'));
  }
  
  console.log('');
}

function printQuickStart(): void {
  console.log(chalk.bold.blue('🚀 快速开始'));
  console.log('');
  console.log(chalk.white('  1. 创建新项目:'));
  console.log(chalk.cyan('     npx create-zhin my-bot'));
  console.log('');
  console.log(chalk.white('  2. 进入项目目录:'));
  console.log(chalk.cyan('     cd my-bot'));
  console.log('');
  console.log(chalk.white('  3. 启动开发服务器:'));
  console.log(chalk.cyan('     pnpm dev'));
  console.log('');
  console.log(chalk.white('  4. 访问 Web 控制台:'));
  console.log(chalk.cyan('     http://localhost:8086'));
  console.log('');
}

function printCommonCommands(): void {
  console.log(chalk.bold.blue('📚 常用命令'));
  console.log('');
  
  const commands = [
    { cmd: 'zhin new <project>', desc: '创建新项目' },
    { cmd: 'zhin dev', desc: '启动开发模式（热重载）' },
    { cmd: 'zhin build', desc: '构建生产版本' },
    { cmd: 'zhin start', desc: '启动生产服务器' },
    { cmd: 'zhin doctor', desc: '检查项目健康状态' },
    { cmd: 'zhin setup', desc: '交互式配置向导' },
    { cmd: 'zhin config', desc: '管理配置文件' },
    { cmd: 'zhin add <plugin>', desc: '添加插件' },
    { cmd: 'zhin install', desc: '安装依赖' }
  ];
  
  commands.forEach(({ cmd, desc }) => {
    console.log(`  ${chalk.cyan(cmd.padEnd(30))} ${chalk.gray(desc)}`);
  });
  
  console.log('');
}

function printResources(): void {
  console.log(chalk.bold.blue('📖 学习资源'));
  console.log('');
  console.log(`  ${chalk.cyan('文档:')}      ${chalk.underline('https://zhinjs.github.io')}`);
  console.log(`  ${chalk.cyan('GitHub:')}    ${chalk.underline('https://github.com/zhinjs/zhin')}`);
  console.log(`  ${chalk.cyan('示例:')}      ${chalk.underline('https://github.com/zhinjs/zhin/tree/main/examples')}`);
  console.log(`  ${chalk.cyan('插件市场:')} ${chalk.underline('https://zhin.js.org/plugins')}`);
  console.log('');
}

function printNextSteps(): void {
  console.log(chalk.bold.blue('🎯 接下来做什么？'));
  console.log('');
  console.log(chalk.white('  • 阅读文档了解核心概念'));
  console.log(chalk.white('  • 尝试创建你的第一个插件'));
  console.log(chalk.white('  • 探索插件市场添加功能'));
  console.log(chalk.white('  • 加入社区与其他开发者交流'));
  console.log('');
}

async function interactiveMode(): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '你想做什么？',
      choices: [
        { name: '🆕 创建新项目', value: 'create' },
        { name: '🔧 配置现有项目', value: 'setup' },
        { name: '🏥 检查项目健康状态', value: 'doctor' },
        { name: '📚 查看文档', value: 'docs' },
        { name: '🚪 退出', value: 'exit' }
      ]
    }
  ]);

  console.log('');

  switch (action) {
    case 'create':
      const { projectName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '项目名称:',
          default: 'my-bot',
          validate: (input: string) => {
            if (!input.trim()) return '项目名称不能为空';
            if (!/^[a-z0-9-_]+$/.test(input)) return '项目名称只能包含小写字母、数字、- 和 _';
            return true;
          }
        }
      ]);

      console.log('');
      console.log(chalk.cyan(`正在创建项目 "${projectName}"...`));
      console.log('');

      try {
        execSync(`npx create-zhin ${projectName}`, { stdio: 'inherit' });
        console.log('');
        console.log(chalk.bold.green('✅ 项目创建成功！'));
        console.log('');
        console.log(chalk.white('下一步:'));
        console.log(chalk.cyan(`  cd ${projectName}`));
        console.log(chalk.cyan('  pnpm dev'));
      } catch (error) {
        logger.error('项目创建失败');
      }
      break;

    case 'setup':
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      
      if (!fs.existsSync(pkgPath)) {
        console.log(chalk.red('❌ 当前目录不是有效的项目'));
        console.log(chalk.gray('提示: 请先使用 ') + chalk.cyan('npx create-zhin') + chalk.gray(' 创建项目'));
        return;
      }

      try {
        const { spawnSync } = await import('child_process');
        spawnSync('zhin', ['setup'], { stdio: 'inherit', shell: true });
      } catch (error) {
        logger.error('配置失败');
      }
      break;

    case 'doctor':
      try {
        const { spawnSync } = await import('child_process');
        spawnSync('zhin', ['doctor'], { stdio: 'inherit', shell: true });
      } catch (error) {
        logger.error('健康检查失败');
      }
      break;

    case 'docs':
      console.log(chalk.cyan('正在打开文档...'));
      try {
        const open = await import('open');
        await open.default('https://zhinjs.github.io');
      } catch {
        console.log('');
        console.log(chalk.yellow('无法自动打开浏览器，请手动访问:'));
        console.log(chalk.underline('https://zhinjs.github.io'));
      }
      break;

    case 'exit':
      console.log(chalk.gray('祝你开发愉快！👋'));
      break;
  }
}

export const onboardingCommand = new Command('onboarding')
  .description('新手引导和快速开始教程')
  .option('-i, --interactive', '交互式引导模式')
  .option('-q, --quick', '仅显示快速开始指南')
  .action(async (options) => {
    if (options.interactive) {
      printWelcome();
      const checks = checkEnvironment();
      printEnvironmentCheck(checks);
      
      if (!checks.node || !checks.pnpm) {
        console.log(chalk.yellow('⚠️  请先安装必需的工具，然后重新运行此命令'));
        return;
      }
      
      await interactiveMode();
      return;
    }

    if (options.quick) {
      printQuickStart();
      return;
    }

    // 默认模式：显示完整引导
    printWelcome();
    const checks = checkEnvironment();
    printEnvironmentCheck(checks);
    
    if (!checks.node || !checks.pnpm) {
      console.log(chalk.yellow('⚠️  请先安装以上工具，然后继续'));
      console.log('');
      return;
    }
    
    printQuickStart();
    printCommonCommands();
    printResources();
    printNextSteps();
    
    console.log(chalk.gray('💡 提示: 运行 ') + chalk.cyan('zhin onboarding -i') + chalk.gray(' 进入交互式引导模式'));
    console.log('');
  });
