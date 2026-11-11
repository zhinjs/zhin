#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

import {
  getDatabaseDisplayName,
  getDatabasePersistenceLabel,
} from './utils.js';
import {
  wizardText,
  getAdapterSetupNotes,
  formatAIDependencyHint,
  configureProjectLocale,
  readProjectLocaleArgument,
} from '@zhin.js/scaffold-wizard';
import { createWorkspace } from './workspace.js';
import { ensurePnpmInstalled, installDependencies, runPostInstallDoctor } from './install.js';
import { assertCreateNodeVersion } from './node-requirement.js';
import { parseCreateArgs, type CreateArgs } from './args.js';
import { renderCreateSummary, resolveCreateOptions } from './flow.js';

async function main() {
  assertCreateNodeVersion();
  const language = readProjectLocaleArgument(process.argv.slice(2));
  let args: CreateArgs;
  try {
    args = parseCreateArgs(language.remaining, language.locale);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
  const skipInstall = args.skipInstall;

  // ADR 0053 §1: language, project name and bootstrap token are the only questions.
  const locale = await configureProjectLocale({ locale: language.locale, yes: args.yes });

  // 检测并安装 pnpm
  if (!skipInstall) await ensurePnpmInstalled(locale);

  try {
    const { name, options } = await resolveCreateOptions(args, locale);

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
    
    // 显示通过参数选择的数据库配置
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
    
    // ADR 0053 §1: start instructions and the Console setup link close the run.
    console.log('');
    const [created, ...rest] = renderCreateSummary({
      locale,
      projectName: realName,
      skipInstall,
      options,
      interactiveTerminal: process.stdout.isTTY === true,
    });
    console.log(chalk.green(created));
    for (const line of rest) console.log(line);
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
