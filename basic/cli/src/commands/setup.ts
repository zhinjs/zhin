import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { CREATE_PROJECT_COMMAND } from '../utils/create-project.js';
import { ensureGlobalHome, installGlobalHomeDeps } from '../utils/global-home-init.js';
import { globalZhinHome } from '../utils/zhin-home.js';
import { logger } from '../utils/logger.js';
import {
  configureDatabaseOptions,
  configureAdapters,
  configureAI,
  getAdapterSetupNotes,
  applyWizardOptionsToConfig,
  appendWizardEnvVars,
  collectWizardDependencies,
  mergeDependenciesIntoPackageJson,
  finalizeWizardOptions,
  type InitOptions,
} from '@zhin.js/scaffold-wizard';

// 引导文件模板（与 create-zhin 保持一致）
const SOUL_MD_TEMPLATE = `# Soul

我是一个能力出众、行动导向的 AI 助手，生活在聊天频道中。

## 性格

- 我偏好行动而非讨论。被要求做事时，我会先使用工具执行，再解释。
- 我直接且简洁。不会用无关的废话或免责声明来填充回复。
- 我有平静的自信。不会过度夸大自己的能力，但在遇到困难时会诚实说明。
- 我会适应用户的语言风格——用户随意时我也随意，用户需要精确时我也精确。
- 我有淡淡的幽默感。恰到好处的一句俏皮话让工作更轻松，但绝不让玩笑妨碍完成任务。
- 我默认乐观。问题是拼图，错误是线索，挫折不过是情节转折。总有下一步值得尝试。

## 价值观

- **可靠胜过炫技。** 宁愿正确地做一件简单的事，也不愿企图做华丽的事然后失败。
- **透明。** 如果工具失败或我不确定，会坦然说明——但带着微笑，而非耸肩。
- **尊重上下文。** 我记住对用户重要的事情，并明智地使用这些知识。
- **效率。** 我不会用不必要的来回浪费用户的时间。
- **好氛围。** 人生苦短，不该忍受机器人般的单调。我给对话带来活力，但不会为此令人烦恼。

## 工作方式

- 对于复杂任务，我会将其分解为步骤并追踪进度。
- 我通过执行工具来验证，而非凭空猜测。
- 我报告结果，而非意图——"已完成"胜过"我会尝试"。
- 当某件事失败时，我报告失败并提出下一步方案。没有戏剧化，只有解决方案。
`;

const TOOLS_MD_TEMPLATE = `# Tools Guide

## 工具使用原则

### 调用风格
- **低风险操作**：直接调用，无需解释（如查询天气、读取文件、搜索）
- **高风险操作**：简要说明理由（如删除文件、执行 shell 命令）
- **多步骤工作流**：先概述计划，再逐步执行

### 工具组合
- 优先使用现有工具完成复杂任务
- 合理串联多个工具以实现目标
- 工具失败时有备选方案

## 常用工具场景

### 文件操作
- \`file_read\` - 读取文件内容
- \`file_write\` - 创建或覆盖文件
- \`file_list\` - 列出目录内容
- \`semantic_search\` - 语义搜索代码

### 网络操作
- \`web_search\` - DuckDuckGo 搜索
- \`web_fetch\` - 获取网页内容

### 系统操作
- \`shell_exec\` - 执行 shell 命令（需谨慎）
- \`plan_create\` - 创建和管理待办计划

### 记忆与学习
- \`memory_store\` - 存储长期记忆
- \`memory_search\` - 检索相关记忆
- \`activate_skill\` - 激活专业技能

## 注意事项
- 工具调用后务必基于结果生成完整回答
- 避免重复调用同一工具获取相同信息
- 遇到权限或依赖问题时，向用户说明并提供替代方案
`;

const AGENTS_MD_TEMPLATE = `# Agent Memory

这是一个长期记忆文件，用于记录重要的对话历史、用户偏好和系统状态。

## 用户偏好
- 语言：简体中文
- 风格：简洁、行动导向

## 系统信息
- 框架：Zhin.js
- 运行时：Node.js

## 重要记录
*(AI 可通过 memory_store 工具在此追加内容)*

## 已完成任务
*(记录重要的完成事项)*

## 待办事项
*(记录未完成的工作)*
`;

async function setupBootstrapFiles(cwd: string): Promise<void> {
  console.log('');
  console.log(chalk.blue('📝 设置引导文件'));
  console.log('');

  const files = [
    { name: 'SOUL.md', description: 'AI 人格定义', template: SOUL_MD_TEMPLATE },
    { name: 'TOOLS.md', description: '工具使用指南', template: TOOLS_MD_TEMPLATE },
    { name: 'AGENTS.md', description: 'Agent 长期记忆', template: AGENTS_MD_TEMPLATE }
  ];

  for (const file of files) {
    const filePath = path.join(cwd, file.name);
    const exists = fs.existsSync(filePath);

    if (exists) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `${file.name} 已存在，是否覆盖？`,
          default: false
        }
      ]);

      if (!overwrite) {
        console.log(chalk.gray(`  跳过 ${file.name}`));
        continue;
      }
    }

    await fs.writeFile(filePath, file.template);
    console.log(chalk.green(`  ✓ 创建 ${file.name} - ${file.description}`));
  }
}

function findConfigFile(cwd: string): string | null {
  const candidates = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json', 'zhin.config.toml', 'zhin.config.ts'];
  return candidates.find(f => fs.existsSync(path.join(cwd, f))) || null;
}

async function readConfig(filePath: string): Promise<any> {
  const ext = path.extname(filePath);
  const content = await fs.readFile(filePath, 'utf-8');

  if (ext === '.yml' || ext === '.yaml') {
    return yaml.parse(content);
  } else if (ext === '.json') {
    return JSON.parse(content);
  }
  // TODO: 支持 TOML 和 TS
  return {};
}

async function saveConfig(filePath: string, config: any): Promise<void> {
  const ext = path.extname(filePath);

  if (ext === '.yml' || ext === '.yaml') {
    await fs.writeFile(filePath, yaml.stringify(config));
  } else if (ext === '.json') {
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  }
}

export const setupCommand = new Command('setup')
  .description('交互式配置向导')
  .option('--global', '在 ~/.zhin 初始化并配置全局实例')
  .option('--bootstrap', '仅配置引导文件')
  .option('--database', '仅配置数据库')
  .option('--adapters', '仅配置适配器')
  .option('--ai', '仅配置 AI')
  .action(async (options) => {
    const cwd = options.global
      ? await ensureGlobalHome({ install: false })
      : process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      if (options.global) {
        logger.error(`无法初始化全局实例目录 ${globalZhinHome()}`);
      } else {
        logger.error(`当前目录不是有效的 Zhin 项目，请先使用 ${CREATE_PROJECT_COMMAND} 创建项目，或 zhin setup --global`);
      }
      process.exit(1);
    }

    if (options.global) {
      console.log(chalk.bold.cyan(`\n🌐 Zhin 全局实例（${globalZhinHome()}）\n`));
    }

    console.log(chalk.bold.cyan('\n🚀 Zhin 配置向导\n'));

    // 加载现有配置
    const configFile = findConfigFile(cwd);
    let config: any = {};
    let configPath = path.join(cwd, 'zhin.config.yml');

    if (configFile) {
      configPath = path.join(cwd, configFile);
      config = await readConfig(configPath);
      console.log(chalk.gray(`已加载配置文件: ${configFile}\n`));
    } else {
      console.log(chalk.yellow('未找到配置文件，将创建 zhin.config.yml\n'));
      config = {
        log_level: 'INFO',
        bots: [],
        plugins: []
      };
    }

    try {
      const wizardOptions: InitOptions = {};

      if (options.bootstrap || (!options.database && !options.adapters && !options.ai)) {
        await setupBootstrapFiles(cwd);
      }

      if (options.database || (!options.bootstrap && !options.adapters && !options.ai)) {
        wizardOptions.database = await configureDatabaseOptions();
      }

      if (options.adapters || (!options.bootstrap && !options.database && !options.ai)) {
        wizardOptions.adapters = await configureAdapters();
      }

      if (options.ai || (!options.bootstrap && !options.database && !options.adapters)) {
        wizardOptions.ai = await configureAI();
      }

      finalizeWizardOptions(wizardOptions);
      applyWizardOptionsToConfig(config, wizardOptions);
      await appendWizardEnvVars(cwd, wizardOptions.adapters, wizardOptions.ai);

      const deps = collectWizardDependencies(wizardOptions);
      const depsChanged = await mergeDependenciesIntoPackageJson(cwd, deps);
      if (depsChanged) {
        console.log(chalk.gray('  ✓ 已更新 package.json 依赖，请运行 pnpm install'));
      }

      if (wizardOptions.adapters) {
        const notes = getAdapterSetupNotes(wizardOptions.adapters);
        if (notes.length > 0) {
          console.log('');
          console.log(chalk.gray('  适配器后续步骤：'));
          for (const note of notes) {
            console.log(chalk.gray(`    • ${note}`));
          }
        }
      }

      // 保存配置
      if (!options.bootstrap) {
        await saveConfig(configPath, config);
        console.log('');
        console.log(chalk.bold.green('✅ 配置已保存'));
        console.log(chalk.gray(`配置文件: ${configPath}`));
      }

      if (options.global) {
        console.log('');
        console.log(chalk.gray('正在安装全局实例依赖…'));
        installGlobalHomeDeps(cwd);
      }

      console.log('');
      console.log(chalk.cyan(options.global
        ? '💡 提示: 任意目录运行 "zhin start" 或 "zhin dev" 启动全局实例'
        : '💡 提示: 运行 "zhin dev" 启动开发服务器'));
    } catch (error: any) {
      logger.error(`配置失败: ${error.message}`);
      process.exit(1);
    }
  });
