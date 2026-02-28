/**
 * onboard — 引导与配置向导（借鉴 OpenClaw onboard）
 *
 * - 在 Zhin 项目内：检测现有配置 → 保持 / 重新配置（回显当前值）/ 重置
 * - 非项目内：创建新项目 / 仅显示快速开始
 * - 重新配置或重置时复用现有配置文件、.env、data 目录，并调用配置向导
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import yaml from 'yaml';
import { logger } from '../utils/logger.js';

const cwd = process.cwd();

// ---------------------------------------------------------------------------
// 环境检查
// ---------------------------------------------------------------------------

function checkEnvironment(): { node: boolean; pnpm: boolean; git: boolean } {
  const checks = { node: false, pnpm: false, git: false };
  try {
    const v = execSync('node -v', { encoding: 'utf-8' }).trim();
    checks.node = parseInt(v.slice(1).split('.')[0], 10) >= 18;
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

function printEnvironmentCheck(checks: ReturnType<typeof checkEnvironment>): void {
  console.log(chalk.bold.blue('📋 环境检查'));
  console.log('');
  console.log(checks.node ? chalk.green('  ✓ Node.js (>= 18)') : chalk.red('  ✗ Node.js (需要 >= 18)'));
  console.log(checks.pnpm ? chalk.green('  ✓ pnpm') : chalk.red('  ✗ pnpm (推荐: npm install -g pnpm)'));
  console.log(checks.git ? chalk.green('  ✓ Git') : chalk.yellow('  ○ Git (可选)'));
  console.log('');
}

// ---------------------------------------------------------------------------
// 项目与配置检测
// ---------------------------------------------------------------------------

function isZhinProject(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = fs.readJsonSync(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return 'zhin.js' in deps || 'zhin' in deps;
  } catch {
    return false;
  }
}

const CONFIG_CANDIDATES = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json', 'zhin.config.toml'];

function findConfigFile(dir: string): string | null {
  return CONFIG_CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) ?? null;
}

async function readConfig(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(content);
  return yaml.parse(content);
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

async function loadExistingState(dir: string): Promise<{
  configPath: string;
  config: any;
  configFormat: string;
  env: Record<string, string>;
  hasDataDir: boolean;
} | null> {
  const configFile = findConfigFile(dir);
  if (!configFile) return null;
  const configPath = path.join(dir, configFile);
  const config = await readConfig(configPath);
  const ext = path.extname(configFile).toLowerCase();
  const configFormat = ext === '.json' ? 'json' : 'yaml';
  const envPath = path.join(dir, '.env');
  let env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    env = parseEnvFile(await fs.readFile(envPath, 'utf-8'));
  }
  const dataDir = path.join(dir, 'data');
  return {
    configPath,
    config,
    configFormat,
    env,
    hasDataDir: fs.existsSync(dataDir),
  };
}

// ---------------------------------------------------------------------------
// 最小默认配置（重置时使用）
// ---------------------------------------------------------------------------

function getMinimalConfig(): any {
  return {
    log_level: 1,
    database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' },
    plugin_dirs: ['node_modules', './src/plugins'],
    services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
    http: { port: 8086, token: '${HTTP_TOKEN}', base: '/api' },
    console: { enabled: true, lazyLoad: true },
    bots: [],
  };
}

// ---------------------------------------------------------------------------
// 欢迎与摘要
// ---------------------------------------------------------------------------

function printWelcome(): void {
  console.log('');
  console.log(chalk.bold.cyan('  ╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║') + chalk.bold.white('           Zhin.js 引导与配置向导 (onboard)                    ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('  ╚═══════════════════════════════════════════════════════════════╝'));
  console.log('');
}

function printSummary(state: NonNullable<Awaited<ReturnType<typeof loadExistingState>>>): void {
  console.log(chalk.bold.blue('📄 当前配置摘要'));
  console.log('');
  console.log(chalk.gray('  配置文件: ') + chalk.cyan(path.basename(state.configPath)));
  if (state.config.database?.dialect) {
    console.log(chalk.gray('  数据库: ') + chalk.cyan(state.config.database.dialect + (state.config.database.filename ? ` (${state.config.database.filename})` : '')));
  }
  const plugins = state.config.plugins as string[] | undefined;
  if (Array.isArray(plugins) && plugins.length > 0) {
    const adapters = plugins.filter((p: string) => typeof p === 'string' && p.includes('adapter-'));
    if (adapters.length > 0) {
      console.log(chalk.gray('  适配器: ') + chalk.cyan(adapters.map((p: string) => p.replace('@zhin.js/adapter-', '')).join(', ')));
    }
  }
  if (state.config.ai?.enabled !== false) {
    console.log(chalk.gray('  AI: ') + chalk.cyan(state.config.ai?.defaultProvider || '未指定'));
  }
  if (state.hasDataDir) {
    console.log(chalk.gray('  data 目录: ') + chalk.green('已存在'));
  }
  console.log('');
}

function printNextSteps(): void {
  console.log(chalk.bold.blue('🎯 下一步'));
  console.log('');
  console.log(chalk.cyan('  pnpm dev') + chalk.gray('          # 开发模式（热重载）'));
  console.log(chalk.cyan('  zhin doctor') + chalk.gray('        # 检查项目健康'));
  console.log(chalk.cyan('  zhin setup') + chalk.gray('         # 再次打开配置向导'));
  console.log(chalk.gray('  Web 控制台: ') + chalk.cyan('http://localhost:8086'));
  console.log('');
}

function printQuickStart(): void {
  console.log(chalk.bold.blue('🚀 快速开始'));
  console.log('');
  console.log(chalk.white('  1. 创建项目: ') + chalk.cyan('npx create-zhin my-bot'));
  console.log(chalk.white('  2. 进入目录: ') + chalk.cyan('cd my-bot'));
  console.log(chalk.white('  3. 启动开发: ') + chalk.cyan('pnpm dev'));
  console.log(chalk.white('  4. 控制台:   ') + chalk.cyan('http://localhost:8086'));
  console.log('');
}

// ---------------------------------------------------------------------------
// 主流程：在项目内
// ---------------------------------------------------------------------------

async function runInProject(_checks: ReturnType<typeof checkEnvironment>): Promise<void> {
  const state = await loadExistingState(cwd);
  const hasExistingConfig = state !== null;

  if (hasExistingConfig && state) {
    console.log(chalk.green('✓ 检测到 Zhin 项目与现有配置'));
    printSummary(state);
  } else {
    console.log(chalk.green('✓ 检测到 Zhin 项目'));
    console.log(chalk.gray('  未找到 zhin.config.*，将使用配置向导创建默认配置。'));
    console.log('');
  }

  type Action = 'keep' | 'modify' | 'reset';
  let action: Action = 'modify';

  if (hasExistingConfig) {
    const { choice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: '选择操作（重新运行向导不会自动覆盖，除非选择重置）:',
        choices: [
          { name: '保持现有配置（仅查看摘要与下一步）', value: 'keep' },
          { name: '重新配置（以当前配置为默认值，逐步修改）', value: 'modify' },
          { name: '重置配置（恢复为最小默认，再运行向导）', value: 'reset' },
        ],
      },
    ]);
    action = choice;
  }

  if (action === 'keep') {
    if (hasExistingConfig && state) printSummary(state);
    printNextSteps();
    return;
  }

  if (action === 'reset' && hasExistingConfig && state) {
    const minimal = getMinimalConfig();
    const configPath = path.join(cwd, state.configFormat === 'json' ? 'zhin.config.json' : 'zhin.config.yml');
    if (state.configFormat === 'json') {
      await fs.writeFile(configPath, JSON.stringify(minimal, null, 2));
    } else {
      await fs.writeFile(configPath, yaml.stringify(minimal));
    }
    console.log(chalk.yellow('已写入最小默认配置，接下来运行配置向导。'));
    console.log('');
  }

  // 复用现有配置、.env、data 目录：由 setup 读取当前 config 并合并
  console.log(chalk.blue('🔧 启动配置向导（zhin setup）'));
  console.log(chalk.gray('  将复用当前配置文件、.env 与 data 目录；修改后保存会合并回原配置。'));
  console.log('');

  const result = spawnSync('zhin', ['setup'], { stdio: 'inherit', shell: true, cwd });
  if (result.status !== 0) {
    logger.error('配置向导未正常结束');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(chalk.bold.green('✅ onboard 完成'));
  printNextSteps();

  const { runDoctor } = await inquirer.prompt([
    { type: 'confirm', name: 'runDoctor', message: '是否运行 zhin doctor 检查项目？', default: true },
  ]);
  if (runDoctor) {
    spawnSync('zhin', ['doctor'], { stdio: 'inherit', shell: true, cwd });
  }
}

// ---------------------------------------------------------------------------
// 主流程：非项目内
// ---------------------------------------------------------------------------

async function runOutsideProject(checks: ReturnType<typeof checkEnvironment>): Promise<void> {
  console.log(chalk.yellow('当前目录不是 Zhin 项目（无 package.json 或未依赖 zhin.js）'));
  console.log('');

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: '选择操作:',
      choices: [
        { name: '创建新项目（npx create-zhin）', value: 'create' },
        { name: '仅显示快速开始步骤', value: 'quick' },
        { name: '退出', value: 'exit' },
      ],
    },
  ]);

  if (choice === 'quick') {
    printQuickStart();
    return;
  }

  if (choice === 'exit') {
    console.log(chalk.gray('可随时在项目目录下运行 zhin onboard 进行配置。'));
    return;
  }

  const { projectName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: '项目名称:',
      default: 'my-bot',
      validate: (input: string) => {
        if (!input.trim()) return '项目名称不能为空';
        if (!/^[a-z0-9-_]+$/.test(input)) return '只能包含小写字母、数字、- 和 _';
        return true;
      },
    },
  ]);

  console.log('');
  try {
    execSync(`npx create-zhin ${projectName}`, { stdio: 'inherit' });
    console.log('');
    console.log(chalk.bold.green('✅ 项目已创建'));
    console.log(chalk.cyan(`  cd ${projectName}`));
    console.log(chalk.cyan('  zhin onboard') + chalk.gray('  # 在项目内继续配置'));
    console.log(chalk.cyan('  pnpm dev'));
  } catch {
    logger.error('创建项目失败');
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const onboardCommand = new Command('onboard')
  .description('引导与配置向导：在项目内复用现有配置/环境变量/data，保持或重新配置')
  .option('-q, --quick', '仅显示快速开始（不进入向导）')
  .option('--flow <flow>', '配置流程: quickstart（少问）| full（默认）', 'full')
  .action(async (options) => {
    printWelcome();
    const checks = checkEnvironment();
    printEnvironmentCheck(checks);

    if (options.quick) {
      printQuickStart();
      return;
    }

    if (!checks.node || !checks.pnpm) {
      console.log(chalk.yellow('请先安装 Node.js (>=18) 与 pnpm 后重试。'));
      process.exitCode = 1;
      return;
    }

    if (isZhinProject(cwd)) {
      await runInProject(checks);
    } else {
      await runOutsideProject(checks);
    }
  });
