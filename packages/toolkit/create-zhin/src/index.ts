#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

import { InitOptions } from './types.js';
import { generateToken, getDatabaseDisplayName } from './utils.js';
import {
  configureDatabaseOptions,
  configureAdapters,
  configureAI,
  getAdapterSetupNotes,
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
} from '@zhin.js/scaffold-wizard';
import { createWorkspace } from './workspace.js';
import { ensurePnpmInstalled, installDependencies } from './install.js';
import { applyStableYesDefaults } from './stable-yes-defaults.js';

async function main() {
  const args = process.argv.slice(2);
  
  const options: InitOptions = {
    yes: args.includes('-y') || args.includes('--yes')
  };
  
  const projectNameArg = args.find(arg => !arg.startsWith('-'));
  
  if (options.yes) {
    options.config = 'yaml';
    options.runtime = 'node';
    options.httpToken = generateToken(16);
  }
  
  // 检测并安装 pnpm
  await ensurePnpmInstalled();
  
  try {
    let name = projectNameArg;
    
    if (!name) {
      const { projectName: inputName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: '请输入项目名称:',
          default: 'my-zhin-bot',
          validate: (input: string) => {
            if (!input.trim()) return '项目名称不能为空';
            if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
              return '项目名称只能包含字母、数字、横线和下划线';
            }
            return true;
          }
        }
      ]);
      name = inputName;
    }

    // 模板选择
    if (!options.template && !options.yes) {
      console.log('');
      console.log(chalk.blue('📋 选择项目模板'));
      const { template } = await inquirer.prompt([
        {
          type: 'select',
          name: 'template',
          message: '选择模板:',
          choices: [
            { name: '默认 — 最小配置，适合首跑和学习', value: 'default' },
            { name: '生活助手 — AI 对话 + 知识库 + 记忆 + 定时提醒', value: 'life-assistant' },
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
          message: '选择运行时:',
          choices: [
            { name: 'Node.js (推荐)', value: 'node' },
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
          message: '选择配置文件格式:',
          choices: [
            { name: 'YAML (推荐)', value: 'yaml' },
            { name: 'JSON', value: 'json' },
            { name: 'TOML', value: 'toml' }
          ],
          default: 'yaml'
        }
      ]);
      options.config = configFormat;
    }
    
    // HTTP Token 认证配置
    if (!options.httpToken) {
      console.log('');
      console.log(chalk.blue('🔐 配置 Web 控制台访问 Token'));
      
      const defaultToken = generateToken(16);
      
      const { token } = await inquirer.prompt([
        {
          type: 'input',
          name: 'token',
          message: 'Web 控制台 Token (用于 Authorization: Bearer 或 ?token= 认证):',
          default: defaultToken,
          validate: (input: string) => {
            if (!input.trim()) return 'Token 不能为空';
            return true;
          }
        }
      ]);
      
      options.httpToken = token;
    }
    
    // 数据库配置（-y Stable 默认无数据库 / inbox）
    if (!options.database && !options.yes) {
      console.log('');
      console.log(chalk.blue('🗄️  配置数据库'));
      
      const databaseConfig = await configureDatabaseOptions();
      options.database = databaseConfig;
    }

    // 适配器 + AI（-y 对齐 minimal-bot）
    if (options.yes) {
      applyStableYesDefaults(options);
    } else {
      if (!options.adapters) {
        options.adapters = await configureAdapters();
      }
      if (!options.ai) {
        options.ai = await configureAI();
      }
    }

    ensureDatabaseForAI(options);
    ensureDatabaseForAdapters(options);

    // 全局 CLI 安装选项
    if (options.installGlobalCli === undefined && !options.yes) {
      console.log('');
      console.log(chalk.blue('🌍 全局 CLI 安装'));
      console.log(chalk.gray('这将允许你在任何目录下使用 "zhin" 命令'));
      
      const { globalCli } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'globalCli',
          message: '是否全局安装 @zhin.js/cli 命令行工具？',
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
      console.log(chalk.blue('🛠️  Zhin 插件开发技能'));
      console.log(chalk.gray('安装一组 AI 技能，帮助你通过 AI 助手高质量地开发、测试和发布 Zhin 插件'));
      console.log(chalk.gray('包含：插件初始化、功能开发、测试编写、质量审查、发布指南'));
      
      const { devSkills } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'devSkills',
          message: '是否安装 Zhin 插件开发技能？（推荐）',
          default: true
        }
      ]);
      options.devSkills = devSkills;
    }

    if (options.devSkills === undefined) {
      options.devSkills = options.yes ? false : true;
    }

    if (!name?.trim()) {
      console.error(chalk.red('项目名称不能为空'));
      process.exit(1);
    }

    const projectPath = path.resolve(process.cwd(), name);
    const realName = path.basename(projectPath);
    
    if (fs.existsSync(projectPath)) {
      console.error(chalk.red(`目录 ${realName} 已存在`));
      process.exit(1);
    }

    console.log(chalk.blue(`正在创建 pnpm workspace 项目 ${realName}...`));
    
    await createWorkspace(projectPath, realName, options);
    
    console.log(chalk.green(`✓ 项目结构创建成功！`));
    console.log('');
    
    console.log(chalk.blue('📦 正在安装依赖...'));
    await installDependencies(projectPath);
    
    console.log('');
    console.log(chalk.green('🎉 项目初始化完成！'));
    console.log('');
    console.log(chalk.blue('🔐 Remote Console 登录信息：'));
    console.log(`  ${chalk.gray('UI:')} ${chalk.cyan('https://console.zhin.dev')}`);
    console.log(`  ${chalk.gray('API Base:')} ${chalk.cyan('http://127.0.0.1:8086')}`);
    console.log(`  ${chalk.gray('Token:')} ${chalk.cyan(options.httpToken)}`);
    console.log(`  ${chalk.yellow('⚠ Token 已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件，用于 Bearer Token 或 Console 登录页')}`);
    
    // 显示数据库配置信息
    if (options.database) {
      console.log('');
      console.log(chalk.blue('🗄️  数据库配置：'));
      console.log(`  ${chalk.gray('类型:')} ${chalk.cyan(getDatabaseDisplayName(options.database.dialect))}`);
      
      if (options.database.dialect === 'sqlite') {
        console.log(`  ${chalk.gray('文件:')} ${chalk.cyan(options.database.filename)}`);
        if (options.database.mode) {
          console.log(`  ${chalk.gray('模式:')} ${chalk.cyan(options.database.mode.toUpperCase())}`);
        }
      } else {
        console.log(`  ${chalk.yellow('⚠ 数据库连接信息已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件')}`);
        console.log(`  ${chalk.gray('请根据实际情况修改数据库连接参数')}`);
      }
    }

    // 显示适配器信息
    if (options.adapters && options.adapters.plugins.length > 0) {
      console.log('');
      console.log(chalk.blue('🔌 已配置适配器：'));
      for (const plugin of options.adapters.plugins) {
        const adapterName = plugin.replace('@zhin.js/adapter-', '');
        console.log(`  ${chalk.gray('•')} ${chalk.cyan(adapterName)}`);
      }
      if (Object.keys(options.adapters.envVars).length > 0) {
        console.log(`  ${chalk.yellow('⚠ 适配器凭据已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件')}`);
      }
      const adapterNotes = getAdapterSetupNotes(options.adapters);
      if (adapterNotes.length > 0) {
        console.log('');
        console.log(chalk.gray('  后续步骤：'));
        for (const note of adapterNotes) {
          console.log(chalk.gray(`    • ${note}`));
        }
      }
    }

    // 显示 AI 配置信息
    if (options.ai?.enabled) {
      console.log('');
      console.log(chalk.blue('🤖 AI 智能体配置：'));
      console.log(`  ${chalk.gray('提供商:')} ${chalk.cyan(options.ai.defaultProvider || 'N/A')}`);
      if (options.ai.trigger) {
        const triggers: string[] = [];
        if (options.ai.trigger.respondToAt) triggers.push('@机器人');
        if (options.ai.trigger.respondToPrivate) triggers.push('私聊');
        if (options.ai.trigger.prefixes.length > 0) triggers.push(`前缀 ${options.ai.trigger.prefixes.join('/')}`);
        console.log(`  ${chalk.gray('触发方式:')} ${chalk.cyan(triggers.join('、'))}`);
      }
      console.log(`  ${chalk.gray('会话/上下文:')} ${chalk.cyan('已启用推荐默认值')}`);
      console.log(`  ${chalk.gray('执行安全:')} ${chalk.cyan(options.ai.agent?.execSecurity || 'deny')}`);
      if (options.ai.memoryMcp) {
        console.log(`  ${chalk.gray('Memory MCP:')} ${chalk.cyan('已启用')}`);
      }
      console.log(`  ${chalk.gray('MCP SDK:')} ${chalk.cyan('已预装 @modelcontextprotocol/sdk')}`);
      if (options.database && options.ai.sessions?.useDatabase !== false) {
        console.log(`  ${chalk.gray('会话存储:')} ${chalk.cyan('SQLite 持久化')}`);
      }
      const providerKey = options.ai.providers && Object.values(options.ai.providers)[0];
      if (providerKey && (providerKey as { apiKey?: string }).apiKey) {
        console.log(`  ${chalk.yellow('⚠ API Key 已保存到')} ${chalk.cyan('.env')} ${chalk.yellow('文件（AI_API_KEY）')}`);
      } else if (options.ai.defaultProvider === 'ollama') {
        console.log(`  ${chalk.gray('提示:')} 请确保 Ollama 已启动且模型已 pull`);
      }
    }

    // 显示开发技能信息
    if (options.devSkills) {
      console.log('');
      console.log(chalk.blue('🛠️  插件开发技能：'));
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-init')}     ${chalk.gray('初始化插件项目结构')}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-develop')}  ${chalk.gray('开发插件功能（命令、中间件、AI 工具等）')}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-test')}     ${chalk.gray('编写和运行测试用例')}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-quality')}  ${chalk.gray('代码质量审查与规范检查')}`);
      console.log(`  ${chalk.gray('•')} ${chalk.cyan('plugin-publish')}  ${chalk.gray('发布到 npm 和插件市场')}`);
      console.log(`  ${chalk.gray('位置:')} ${chalk.cyan('skills/')} ${chalk.gray('目录')}`);
    }
    
    console.log('');
    console.log('📝 下一步操作：');
    console.log(`  ${chalk.cyan(`cd ${realName}`)}`);
    if (options.database?.dialect === 'sqlite') {
      console.log(`  ${chalk.gray('# SQLite 使用 Node 内置 node:sqlite，请使用 Node.js 22.5+（推荐 24+）')}`);
    }
    
    
    // 根据是否全局安装 CLI，显示不同的命令
    if (options.installGlobalCli) {
      console.log('');
      console.log(chalk.green('✓ 已为你配置全局 CLI'));
      console.log(`  ${chalk.cyan('pnpm link')} ${chalk.gray('# 执行一次以链接全局 CLI')}`);
      console.log('');
      console.log(chalk.yellow('开发环境：'));
      console.log(`  ${chalk.cyan('zhin dev')} ${chalk.gray('# 或 pnpm dev - 开发模式（自动监听，支持热重载）')}`);
      console.log('');
      console.log(chalk.yellow('生产环境：'));
      console.log(`  ${chalk.cyan('zhin build')} ${chalk.gray('# 或 pnpm build - 构建客户端代码和所有插件')}`);
      console.log(`  ${chalk.cyan('zhin start')} ${chalk.gray('# 或 pnpm start - 前台运行')}`);
      console.log(`  ${chalk.cyan('zhin start --daemon')} ${chalk.gray('# 或 pnpm daemon - 后台运行（内置守护）')}`);
      console.log(`  ${chalk.cyan('zhin stop')} ${chalk.gray('# 或 pnpm stop - 停止后台服务')}`);
      console.log('');
      console.log(chalk.yellow('PM2 进程管理（推荐生产环境）：'));
      console.log(`  ${chalk.cyan('pnpm pm2:start')} ${chalk.gray('# 启动 PM2 守护进程')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:stop')} ${chalk.gray('# 停止服务')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:restart')} ${chalk.gray('# 重启服务')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:logs')} ${chalk.gray('# 查看日志')}`);
      console.log('');
      console.log(chalk.yellow('插件开发：'));
      console.log(`  ${chalk.cyan('zhin new <plugin-name>')} ${chalk.gray('# 创建新插件')}`);
    } else {
      console.log('');
      console.log(chalk.blue('💡 使用 pnpm 和 npx 运行命令：'));
      console.log('');
      console.log(chalk.yellow('开发环境：'));
      console.log(`  ${chalk.cyan('pnpm dev')} ${chalk.gray('# 或 npx zhin dev - 开发模式（自动监听，支持热重载）')}`);
      console.log('');
      console.log(chalk.yellow('生产环境：'));
      console.log(`  ${chalk.cyan('pnpm build')} ${chalk.gray('# 或 npx zhin build - 构建客户端代码和所有插件')}`);
      console.log(`  ${chalk.cyan('pnpm start')} ${chalk.gray('# 或 npx zhin start - 前台运行')}`);
      console.log(`  ${chalk.cyan('pnpm daemon')} ${chalk.gray('# 或 npx zhin start --daemon - 后台运行（内置守护）')}`);
      console.log(`  ${chalk.cyan('pnpm stop')} ${chalk.gray('# 或 npx zhin stop - 停止后台服务')}`);
      console.log('');
      console.log(chalk.yellow('PM2 进程管理（推荐生产环境）：'));
      console.log(`  ${chalk.cyan('pnpm pm2:start')} ${chalk.gray('# 启动 PM2 守护进程')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:stop')} ${chalk.gray('# 停止服务')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:restart')} ${chalk.gray('# 重启服务')}`);
      console.log(`  ${chalk.cyan('pnpm pm2:logs')} ${chalk.gray('# 查看日志')}`);
      console.log('');
      console.log(chalk.yellow('插件开发：'));
      console.log(`  ${chalk.cyan('npx zhin new <plugin-name>')} ${chalk.gray('# 创建新插件')}`);
      console.log('');
      console.log(chalk.gray('💡 后续如需全局安装 CLI，可运行：'));
      console.log(`  ${chalk.cyan('pnpm link')} ${chalk.gray('# 在项目根目录执行，链接全局 CLI')}`);
    }
    
    console.log('');
    console.log('📚 相关文档：');
    console.log(`  ${chalk.cyan('https://github.com/zhinjs/zhin')}`);
    console.log(`  ${chalk.cyan('https://zhin.js.org')}`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error(chalk.red(`创建项目失败: ${errorMessage}`));
    if (errorStack && process.env.DEBUG) {
      console.error(chalk.gray(errorStack));
    }
    process.exit(1);
  }
}

main();
