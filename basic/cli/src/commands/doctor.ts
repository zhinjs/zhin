import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export const doctorCommand = new Command('doctor')
  .alias('health')
  .description('检查系统环境和项目配置')
  .option('--fix', '自动修复可修复的问题')
  .action(async (options) => {
    console.log(chalk.blue('🏥 Zhin.js 健康检查'));
    console.log('');

    const results: CheckResult[] = [];
    const cwd = process.cwd();

    // 1. 检查 Node.js 版本
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    results.push({
      name: 'Node.js 版本',
      status: nodeMajor >= 18 ? 'ok' : 'error',
      message: nodeMajor >= 18 
        ? `${nodeVersion} (推荐 >= 18.0.0)` 
        : `${nodeVersion} (需要 >= 18.0.0)`,
      fix: nodeMajor < 18 ? '请升级 Node.js: https://nodejs.org' : undefined
    });

    // 2. 检查 pnpm
    try {
      const { stdout } = await execAsync('pnpm --version');
      const pnpmVersion = stdout.trim();
      results.push({
        name: 'pnpm',
        status: 'ok',
        message: `v${pnpmVersion}`
      });
    } catch {
      results.push({
        name: 'pnpm',
        status: 'error',
        message: '未安装',
        fix: 'npm install -g pnpm'
      });
    }

    // 3. 检查配置文件
    const configFiles = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json', 'zhin.config.toml', 'zhin.config.ts'];
    const existingConfig = configFiles.find(f => fs.existsSync(path.join(cwd, f)));
    
    if (existingConfig) {
      results.push({
        name: '配置文件',
        status: 'ok',
        message: existingConfig
      });
    } else {
      results.push({
        name: '配置文件',
        status: 'warn',
        message: '未找到配置文件',
        fix: options.fix ? '将创建默认配置' : 'zhin setup'
      });
      
      if (options.fix) {
        // 创建默认配置
        await createDefaultConfig(cwd);
        logger.info('已创建默认配置文件: zhin.config.yml');
      }
    }

    // 4. 检查引导文件
    const bootstrapFiles = ['SOUL.md', 'TOOLS.md', 'AGENTS.md'];
    const missingBootstrap: string[] = [];
    
    for (const file of bootstrapFiles) {
      const filePath = path.join(cwd, file);
      if (!fs.existsSync(filePath)) {
        missingBootstrap.push(file);
      }
    }
    
    if (missingBootstrap.length === 0) {
      results.push({
        name: '引导文件',
        status: 'ok',
        message: '所有引导文件都存在'
      });
    } else {
      results.push({
        name: '引导文件',
        status: 'warn',
        message: `缺少: ${missingBootstrap.join(', ')}`,
        fix: options.fix ? '将创建缺失的引导文件' : 'zhin setup --bootstrap'
      });
      
      if (options.fix) {
        await createMissingBootstrapFiles(cwd, missingBootstrap);
        logger.info(`已创建引导文件: ${missingBootstrap.join(', ')}`);
      }
    }

    // 5. 检查 package.json
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = await fs.readJSON(pkgPath);
        const hasZhin = pkg.dependencies?.['zhin.js'] || pkg.devDependencies?.['zhin.js'];
        
        results.push({
          name: 'package.json',
          status: hasZhin ? 'ok' : 'warn',
          message: hasZhin ? '已配置 zhin.js' : '未安装 zhin.js',
          fix: hasZhin ? undefined : 'pnpm install zhin.js'
        });
      } catch (err: any) {
        results.push({
          name: 'package.json',
          status: 'error',
          message: `解析失败: ${err.message}`
        });
      }
    } else {
      results.push({
        name: 'package.json',
        status: 'warn',
        message: '不存在',
        fix: 'pnpm init'
      });
    }

    // 6. 检查 node_modules
    const nodeModulesPath = path.join(cwd, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      results.push({
        name: '依赖安装',
        status: 'ok',
        message: 'node_modules 存在'
      });
    } else {
      results.push({
        name: '依赖安装',
        status: 'warn',
        message: 'node_modules 不存在',
        fix: 'pnpm install'
      });
    }

    // 7. 检查端口占用（8086）
    try {
      const { stdout } = await execAsync('lsof -i:8086 || (ss -lntp | grep :8086) 2>/dev/null');
      if (stdout.trim()) {
        results.push({
          name: '端口 8086',
          status: 'warn',
          message: '已被占用',
          fix: 'lsof -ti:8086 | xargs kill -9'
        });
      } else {
        results.push({
          name: '端口 8086',
          status: 'ok',
          message: '可用'
        });
      }
    } catch {
      results.push({
        name: '端口 8086',
        status: 'ok',
        message: '可用'
      });
    }

    // 8. 检查 TypeScript
    if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
      try {
        const { stdout } = await execAsync('tsc --version');
        results.push({
          name: 'TypeScript',
          status: 'ok',
          message: stdout.trim()
        });
      } catch {
        results.push({
          name: 'TypeScript',
          status: 'warn',
          message: '未安装',
          fix: 'pnpm add -D typescript'
        });
      }
    }

    // 9. 检查环境变量文件
    const envFile = path.join(cwd, '.env');
    if (fs.existsSync(envFile)) {
      results.push({
        name: '环境变量',
        status: 'ok',
        message: '.env 文件存在'
      });
    } else {
      results.push({
        name: '环境变量',
        status: 'warn',
        message: '.env 文件不存在',
        fix: options.fix ? '将创建空的 .env 文件' : '手动创建 .env 文件'
      });
      
      if (options.fix) {
        await fs.writeFile(envFile, '# Zhin.js 环境变量\n');
        logger.info('已创建 .env 文件');
      }
    }

    // 打印结果
    console.log('');
    let hasErrors = false;
    let hasWarnings = false;

    for (const result of results) {
      const icon = result.status === 'ok' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
      const color = result.status === 'ok' ? chalk.green : result.status === 'warn' ? chalk.yellow : chalk.red;
      
      console.log(`${icon} ${chalk.bold(result.name)}: ${color(result.message)}`);
      
      if (result.fix && !options.fix) {
        console.log(`   ${chalk.gray('修复:')} ${chalk.cyan(result.fix)}`);
      }
      
      if (result.status === 'error') hasErrors = true;
      if (result.status === 'warn') hasWarnings = true;
    }

    console.log('');
    
    if (hasErrors) {
      console.log(chalk.red('❌ 发现严重问题，请修复后再运行'));
      process.exit(1);
    } else if (hasWarnings) {
      console.log(chalk.yellow('⚠️  发现警告，建议修复以获得最佳体验'));
      if (!options.fix) {
        console.log(chalk.gray('提示: 运行 ') + chalk.cyan('zhin doctor --fix') + chalk.gray(' 自动修复可修复的问题'));
      }
    } else {
      console.log(chalk.green('✅ 所有检查通过！'));
    }
  });

async function createDefaultConfig(cwd: string): Promise<void> {
  const configContent = `log_level: 0
database:
  dialect: sqlite
  filename: ./data/bot.db
bots:
  - context: sandbox
    name: sandbox-bot
plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/http"
  - "@zhin.js/console"
http:
  host: 0.0.0.0
  port: 8086
  username: admin
  password: admin123
ai:
  enabled: false
`;
  await fs.writeFile(path.join(cwd, 'zhin.config.yml'), configContent);
}

async function createMissingBootstrapFiles(cwd: string, files: string[]): Promise<void> {
  const templates: Record<string, string> = {
    'SOUL.md': `# Soul\n\n我是一个能力出众、行动导向的 AI 助手。\n`,
    'TOOLS.md': `# Tools Guide\n\n## 工具使用原则\n\n- 低风险操作：直接调用\n- 高风险操作：简要说明理由\n`,
    'AGENTS.md': `# Agent Memory\n\n这是一个长期记忆文件，用于记录重要信息。\n`
  };
  
  for (const file of files) {
    if (templates[file]) {
      await fs.writeFile(path.join(cwd, file), templates[file]);
    }
  }
}
