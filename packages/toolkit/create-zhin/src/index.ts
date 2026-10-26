#!/usr/bin/env node
import { wizardText } from '@zhin.js/scaffold-wizard';

import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

import { InitOptions } from './types.js';
import {
  describeStoredHttpToken,
  generateToken,
  getDatabaseDisplayName,
  getDatabasePersistenceLabel,
  isValidProjectName,
} from './utils.js';
import {
  configureDatabaseOptions,
  configureAdapters,
  configureAI,
  getAdapterSetupNotes,
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
  formatAIDependencyHint,
  DEFAULT_CREATE_BOT_HTTP_PORT,
  configureProjectLocale,
  readProjectLocaleArgument,
} from '@zhin.js/scaffold-wizard';
import { createWorkspace } from './workspace.js';
import { ensurePnpmInstalled, installDependencies, runPostInstallDoctor } from './install.js';
import { applyStableYesDefaults } from './stable-yes-defaults.js';
import { assertCreateNodeVersion } from './node-requirement.js';

async function main() {
  assertCreateNodeVersion();
  const language = readProjectLocaleArgument(process.argv.slice(2));
  const args = language.remaining;
  const skipInstall = args.includes('--skip-install');
  
  const options: InitOptions = {
    yes: args.includes('-y') || args.includes('--yes')
  };
  options.locale = await configureProjectLocale({ locale: language.locale, yes: options.yes });
  const locale = options.locale;
  
  const projectNameArg = args.find(arg => !arg.startsWith('-'));
  
  if (options.yes) {
    options.config = 'yaml';
    options.runtime = 'node';
    options.httpToken = generateToken(16, locale);
  }
  
  // 检测并安装 pnpm
  if (!skipInstall) await ensurePnpmInstalled(locale);
  
  try {
    let name = projectNameArg;
    
    if (!name) {
      const { projectName: inputName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: wizardText(locale, "请输入项目名称:"),
          default: 'my-zhin-bot',
          validate: (input: string) => {
            if (!input.trim()) return wizardText(locale, "项目名称不能为空");
            if (!isValidProjectName(input)) {
              return wizardText(locale, "项目名称只能包含字母、数字、横线和下划线");
            }
            return true;
          }
        }
      ]);
      name = inputName;
    } else if (!isValidProjectName(name)) {
      console.error(chalk.red(wizardText(locale, "项目名称只能包含字母、数字、横线和下划线")));
      process.exit(1);
    }

    // 模板选择
    if (!options.template && !options.yes) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "📋 选择项目模板")));
      const { template } = await inquirer.prompt([
        {
          type: 'select',
          name: 'template',
          message: wizardText(locale, "选择模板:"),
          choices: [
            { name: wizardText(locale, "默认 — 最小配置，适合首跑和学习"), value: 'default' },
            { name: wizardText(locale, "生活助手 — AI 对话 + 知识库 + 记忆 + 定时提醒"), value: 'life-assistant' },
          ],
          default: 'default',
        },
      ]);
      options.template = template;
    }
    if (!options.template) {
      options.template = 'default';
    }
    
    if (!options.runtime) {
      const { runtime } = await inquirer.prompt([
        {
          type: 'select',
          name: 'runtime',
          message: wizardText(locale, "选择运行时:"),
          choices: [
            { name: wizardText(locale, "Node.js (推荐)"), value: 'node' },
            { name: 'Bun', value: 'bun' }
          ],
          default: 'node'
        }
      ]);
      options.runtime = runtime;
    }
    
    if (!options.config) {
      const { configFormat } = await inquirer.prompt([
        {
          type: 'select',
          name: 'configFormat',
          message: wizardText(locale, "选择配置文件格式:"),
          choices: [
            { name: wizardText(locale, "YAML (推荐)"), value: 'yaml' },
            { name: 'JSON', value: 'json' }
          ],
          default: 'yaml'
        }
      ]);
      options.config = configFormat;
    }
    
    // HTTP Token 认证配置
    if (!options.httpToken) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🔐 配置 Web 控制台访问 Token")));
      
      const defaultToken = generateToken(16, locale);
      
      const { token } = await inquirer.prompt([
        {
          type: 'input',
          name: 'token',
          message: wizardText(locale, "Web 控制台 Token (用于 Authorization: Bearer 或 ?token= 认证):"),
          default: defaultToken,
          validate: (input: string) => {
            if (!input.trim()) return wizardText(locale, "Token 不能为空");
            return true;
          }
        }
      ]);
      
      options.httpToken = token;
    }
    
    // 数据库配置（-y Stable 默认无数据库 / inbox）
    if (!options.database && !options.yes) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🗄️  配置数据库")));
      
      const databaseConfig = await configureDatabaseOptions(locale);
      options.database = databaseConfig;
    }

    // 适配器 + AI（-y 对齐 minimal-bot）
    if (options.yes) {
      applyStableYesDefaults(options);
    } else {
      if (!options.adapters) {
        options.adapters = await configureAdapters(locale);
      }
      if (!options.ai) {
        options.ai = await configureAI(locale);
      }
    }

    ensureDatabaseForAI(options);
    ensureDatabaseForAdapters(options);

    // 全局 CLI 安装选项
    if (options.installGlobalCli === undefined && !options.yes) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🌍 全局 CLI 安装")));
      console.log(chalk.gray(wizardText(locale, "这将允许你在任何目录下使用 \"zhin\" 命令")));
      
      const { globalCli } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'globalCli',
          message: wizardText(locale, "是否全局安装 @zhin.js/cli 命令行工具？"),
          default: false
        }
      ]);
      options.installGlobalCli = globalCli;
    }

    // -y 模式下默认不全局安装
    if (options.installGlobalCli === undefined) {
      options.installGlobalCli = false;
    }

    // 开发技能安装选项
    if (options.devSkills === undefined && !options.yes) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🛠️  Zhin 插件开发技能")));
      console.log(chalk.gray(wizardText(locale, "安装一组 AI 技能，帮助你通过 AI 助手高质量地开发、测试和发布 Zhin 插件")));
      console.log(chalk.gray(wizardText(locale, "包含：插件初始化、功能开发、测试编写、质量审查、发布指南")));
      
      const { devSkills } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'devSkills',
          message: wizardText(locale, "是否安装 Zhin 插件开发技能？（推荐）"),
          default: true
        }
      ]);
      options.devSkills = devSkills;
    }

    if (options.devSkills === undefined) {
      options.devSkills = options.yes ? false : true;
    }

    if (!name?.trim()) {
      console.error(chalk.red(wizardText(locale, "项目名称不能为空")));
      process.exit(1);
    }

    const projectPath = path.resolve(process.cwd(), name);
    const realName = path.basename(projectPath);
    
    if (fs.existsSync(projectPath)) {
      console.error(chalk.red(wizardText(locale, "目录 {v0} 已存在", [realName])));
      process.exit(1);
    }

    console.log(chalk.blue(wizardText(locale, "正在创建 pnpm workspace 项目 {v0}...", [realName])));
    
    await createWorkspace(projectPath, realName, options);
    
    console.log(chalk.green(wizardText(locale, "✓ 项目结构创建成功！")));
    console.log('');
    
    if (!skipInstall) {
      console.log(chalk.blue(wizardText(locale, "📦 正在安装依赖...")));
      await installDependencies(projectPath, locale);
      console.log('');
      await runPostInstallDoctor(projectPath, locale);
    } else {
      console.log(wizardText(locale, "已跳过安装；进入项目后运行 pnpm install，再运行 pnpm dev。"));
    }
    
    console.log('');
    console.log(chalk.green(wizardText(locale, "🎉 项目初始化完成！")));
    console.log('');
    console.log(chalk.blue(wizardText(locale, "🔐 Remote Console 登录信息：")));
    console.log(`  ${chalk.gray('UI:')} ${chalk.cyan('https://console.zhin.dev')}`);
    console.log(`  ${chalk.gray('API Base:')} ${chalk.cyan(`http://127.0.0.1:${DEFAULT_CREATE_BOT_HTTP_PORT}`)}`);
    console.log(`  ${chalk.gray('Token:')} ${chalk.cyan(describeStoredHttpToken(options.httpToken ?? '', locale))}`);
    console.log(`  ${chalk.gray('Sandbox:')} ${chalk.cyan(wizardText(locale, "打开 Console 后进入 Sandbox / 沙盒页，连接后发送 /hello"))}`);
    console.log(`  ${chalk.yellow(wizardText(locale, "⚠ Token 已保存到"))} ${chalk.cyan('.env')} ${chalk.yellow(wizardText(locale, "文件，用于 Bearer Token 或 Console 登录页"))}`);
    
    // 显示数据库配置信息
    if (options.database) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🗄️  数据库配置：")));
      console.log(`  ${chalk.gray(wizardText(locale, "类型:"))} ${chalk.cyan(getDatabaseDisplayName(options.database.dialect))}`);
      
      if (options.database.dialect === 'sqlite') {
        console.log(`  ${chalk.gray(wizardText(locale, "文件:"))} ${chalk.cyan(options.database.filename)}`);
        if (options.database.mode) {
          console.log(`  ${chalk.gray(wizardText(locale, "模式:"))} ${chalk.cyan(options.database.mode.toUpperCase())}`);
        }
      } else if (options.database.dialect === 'memory') {
        console.log(`  ${chalk.yellow(wizardText(locale, "⚠ 仅用于测试，进程退出后数据不会保留"))}`);
      } else {
        console.log(`  ${chalk.yellow(wizardText(locale, "⚠ 数据库连接信息已保存到"))} ${chalk.cyan('.env')} ${chalk.yellow(wizardText(locale, "文件"))}`);
        console.log(`  ${chalk.gray(wizardText(locale, "请根据实际情况修改数据库连接参数"))}`);
        console.log(`  ${chalk.gray(wizardText(locale, "启动前校验:"))} ${chalk.cyan('npx zhin config check')}`);
      }
    }

    // 显示适配器信息
    if (options.adapters && options.adapters.plugins.length > 0) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🔌 已配置适配器：")));
      for (const plugin of options.adapters.plugins) {
        const adapterName = plugin.replace('@zhin.js/adapter-', '');
        console.log(`  ${chalk.gray('•')} ${chalk.cyan(adapterName)}`);
      }
      if (Object.keys(options.adapters.envVars).length > 0) {
        console.log(`  ${chalk.yellow(wizardText(locale, "⚠ 适配器凭据已保存到"))} ${chalk.cyan('.env')} ${chalk.yellow(wizardText(locale, "文件"))}`);
      }
      const adapterNotes = getAdapterSetupNotes(options.adapters, locale);
      if (adapterNotes.length > 0) {
        console.log('');
        console.log(chalk.gray(wizardText(locale, "  后续步骤：")));
        for (const note of adapterNotes) {
          console.log(chalk.gray(`    • ${note}`));
        }
      }
    }

    // 显示 AI 配置信息
    if (options.ai?.enabled) {
      const agentProvider = options.ai.agentProvider;
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🤖 AI 智能体配置：")));
      console.log(`  ${chalk.gray(wizardText(locale, "提供商:"))} ${chalk.cyan(agentProvider || 'N/A')}`);
      if (options.ai.trigger) {
        const triggers: string[] = [];
        if (options.ai.trigger.respondToAt) triggers.push(wizardText(locale, "@机器人"));
        if (options.ai.trigger.respondToPrivate) triggers.push(wizardText(locale, "私聊"));
        if (options.ai.trigger.prefixes.length > 0) triggers.push(wizardText(locale, "前缀 {v0}", [options.ai.trigger.prefixes.join('/')]));
        console.log(`  ${chalk.gray(wizardText(locale, "触发方式:"))} ${chalk.cyan(triggers.join('、'))}`);
      }
      console.log(`  ${chalk.gray(wizardText(locale, "会话/上下文:"))} ${chalk.cyan(wizardText(locale, "已启用推荐默认值"))}`);
      console.log(`  ${chalk.gray(wizardText(locale, "执行安全:"))} ${chalk.cyan(options.ai.agent?.execSecurity || 'deny')}`);
      if (options.ai.memoryMcp) {
        console.log(`  ${chalk.gray('Memory MCP:')} ${chalk.cyan(wizardText(locale, "已启用"))}`);
      }
      console.log(`  ${chalk.gray(wizardText(locale, "依赖:"))} ${chalk.cyan(formatAIDependencyHint(agentProvider))}`);
      if (options.database && options.ai.sessions?.useDatabase !== false) {
        console.log(`  ${chalk.gray(wizardText(locale, "会话存储:"))} ${chalk.cyan(getDatabasePersistenceLabel(options.database.dialect, locale))}`);
      }
      const providerKey = options.ai.providers && Object.values(options.ai.providers)[0];
      if (providerKey && (providerKey as { apiKey?: string }).apiKey) {
        console.log(`  ${chalk.yellow(wizardText(locale, "⚠ API Key 已保存到"))} ${chalk.cyan('.env')} ${chalk.yellow(wizardText(locale, "文件（AI_API_KEY）"))}`);
      } else if (agentProvider === 'ollama') {
        console.log(wizardText(locale, "  {v0} 请确保 Ollama 已启动且模型已 pull", [chalk.gray(wizardText(locale, "提示:"))]));
      }
    }

    // 显示开发技能信息
    if (options.devSkills) {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "🛠️  插件开发技能：")));
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-init')}     ${chalk.gray(wizardText(locale, "初始化插件项目结构"))}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-develop')}  ${chalk.gray(wizardText(locale, "开发插件功能（命令、中间件、AI 工具等）"))}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-test')}     ${chalk.gray(wizardText(locale, "编写和运行测试用例"))}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-quality')}  ${chalk.gray(wizardText(locale, "代码质量审查与规范检查"))}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-publish')}  ${chalk.gray(wizardText(locale, "发布到 npm 和插件市场"))}`);
      console.log(`  ${chalk.gray(wizardText(locale, "位置:"))} ${chalk.cyan('skills/')} ${chalk.gray(wizardText(locale, "目录"))}`);
    }
    
    console.log('');
    console.log(wizardText(locale, "📝 下一步操作："));
    console.log(`  ${chalk.cyan(`cd ${realName}`)}`);
    console.log(`  ${chalk.cyan('pnpm dev')} ${chalk.gray(wizardText(locale, "# zhin runtime start，然后打开 Console 的 Sandbox 页发送 /hello"))}`);
    console.log('');
    console.log(chalk.blue(wizardText(locale, "下一步（任选）：")));
    console.log(`  ${chalk.gray(wizardText(locale, "接 QQ/Discord"))}    ${chalk.cyan('npx zhin setup --adapters')}`);
    console.log(`  ${chalk.gray(wizardText(locale, "启用 AI 对话"))}     ${chalk.cyan('npx zhin setup --ai')}`);
    console.log(`  ${chalk.gray(wizardText(locale, "写插件"))}           ${chalk.cyan('npx @zhin.js/cli new my-plugin --standalone')} ${chalk.gray(wizardText(locale, "(文档 https://zhin.js.org/getting-started/first-plugin)"))}`);
    console.log(`  ${chalk.gray(wizardText(locale, "诊断"))}             ${chalk.cyan('npx zhin doctor')}`);
    if (options.database?.dialect === 'sqlite') {
      console.log(`  ${chalk.gray(wizardText(locale, "# SQLite 使用 Node 内置 node:sqlite，请使用 Node.js 22.5+（推荐 24+）"))}`);
    }


    // 根据是否全局安装 CLI，显示不同的命令
    if (options.installGlobalCli) {
      console.log('');
      console.log(chalk.green(wizardText(locale, "✓ 已为你配置全局 CLI")));
      console.log(`  ${chalk.cyan('pnpm link')} ${chalk.gray(wizardText(locale, "# 执行一次以链接全局 CLI"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "开发环境：")));
      console.log(`  ${chalk.cyan('zhin runtime start')} ${chalk.gray(wizardText(locale, "# 或 pnpm dev - 开发模式（自动监听，支持热重载）"))}`);
      console.log(`  ${chalk.cyan('zhin doctor')} ${chalk.gray(wizardText(locale, "# 检查 Console / Host / Sandbox / 依赖状态"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "生产环境：")));
      console.log(`  ${chalk.cyan('zhin runtime start --mode production --no-watch')} ${chalk.gray(wizardText(locale, "# 或 pnpm start - 前台运行"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "PM2 进程管理（推荐生产环境）：")));
      console.log(`  ${chalk.cyan('pnpm pm2:start')} ${chalk.gray(wizardText(locale, "# 启动 PM2 守护进程"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:stop')} ${chalk.gray(wizardText(locale, "# 停止服务"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:restart')} ${chalk.gray(wizardText(locale, "# 重启服务"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:logs')} ${chalk.gray(wizardText(locale, "# 查看日志"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "插件开发：")));
      console.log(`  ${chalk.cyan('zhin new <plugin-name>')} ${chalk.gray(wizardText(locale, "# 创建项目内插件；独立插件加 --standalone"))}`);
    } else {
      console.log('');
      console.log(chalk.blue(wizardText(locale, "💡 使用 pnpm 和 npx 运行命令：")));
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "开发环境：")));
      console.log(`  ${chalk.cyan('pnpm dev')} ${chalk.gray(wizardText(locale, "# 或 npx zhin runtime start - 开发模式（自动监听，支持热重载）"))}`);
      console.log(`  ${chalk.cyan('npx zhin doctor')} ${chalk.gray(wizardText(locale, "# 检查 Console / Host / Sandbox / 依赖状态"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "生产环境：")));
      console.log(`  ${chalk.cyan('pnpm start')} ${chalk.gray(wizardText(locale, "# 或 npx zhin runtime start --mode production --no-watch - 前台运行"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "PM2 进程管理（推荐生产环境）：")));
      console.log(`  ${chalk.cyan('pnpm pm2:start')} ${chalk.gray(wizardText(locale, "# 启动 PM2 守护进程"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:stop')} ${chalk.gray(wizardText(locale, "# 停止服务"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:restart')} ${chalk.gray(wizardText(locale, "# 重启服务"))}`);
      console.log(`  ${chalk.cyan('pnpm pm2:logs')} ${chalk.gray(wizardText(locale, "# 查看日志"))}`);
      console.log('');
      console.log(chalk.yellow(wizardText(locale, "插件开发：")));
      console.log(`  ${chalk.cyan('npx zhin new <plugin-name>')} ${chalk.gray(wizardText(locale, "# 创建项目内插件；独立插件加 --standalone"))}`);
      console.log('');
      console.log(chalk.gray(wizardText(locale, "💡 后续如需全局安装 CLI，可运行：")));
      console.log(`  ${chalk.cyan('pnpm link')} ${chalk.gray(wizardText(locale, "# 在项目根目录执行，链接全局 CLI"))}`);
    }
    
    console.log('');
    console.log(wizardText(locale, "📚 相关文档："));
    console.log(`  ${chalk.cyan('https://github.com/zhinjs/zhin')}`);
    console.log(`  ${chalk.cyan('https://zhin.js.org')}`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error(chalk.red(wizardText(locale, "创建项目失败: {v0}", [errorMessage])));
    if (errorStack && process.env.DEBUG) {
      console.error(chalk.gray(errorStack));
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
