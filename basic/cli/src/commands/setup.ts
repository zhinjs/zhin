import { wizardText } from '@zhin.js/scaffold-wizard';
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { formatDisplayPath } from '@zhin.js/logger';
import { readPluginConfigurationMap, resolveLocale } from '@zhin.js/plugin-runtime';
import { CREATE_PROJECT_COMMAND } from '../utils/create-project.js';
import { ensureGlobalHome, installGlobalHomeDeps } from '../utils/global-home-init.js';
import { globalZhinHome } from '../utils/zhin-home.js';
import { logger } from '../utils/logger.js';
import { findConfigFile, prepareConfigSave, readConfig } from '../utils/config-file.js';
import {
  configureDatabaseOptions,
  configureAdapters,
  configureAI,
  configureTypeSafeDecisions,
  applyTypeSafeDecisionsToConfig,
  saveTypeSafeSetupDependencies,
  getAdapterSetupNotes,
  applyWizardOptionsToConfig,
  appendWizardEnvVars,
  collectWizardDependencies,
  collectWizardFeatures,
  mergeDependenciesIntoPackageJson,
  mergeFeaturesIntoPackageJson,
  finalizeWizardOptions,
  formatAIDependencyHint,
  validateProjectLocale,
  type InitOptions,
} from '@zhin.js/scaffold-wizard';

async function setupBootstrapFiles(cwd: string, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<void> {
  console.log('');
  console.log(chalk.blue(wizardText(locale, "📝 设置引导文件")));
  console.log('');

  const files = [
    { name: 'SOUL.md', description: wizardText(locale, "AI 人格定义"), template: wizardText(locale, 'templates.setupSoul') },
    { name: 'TOOLS.md', description: wizardText(locale, "工具使用指南"), template: wizardText(locale, 'templates.setupTools') },
    { name: 'AGENTS.md', description: wizardText(locale, "Agent 长期记忆"), template: wizardText(locale, 'templates.setupAgentMemory') }
  ];

  for (const file of files) {
    const filePath = path.join(cwd, file.name);
    const exists = fs.existsSync(filePath);

    if (exists) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: wizardText(locale, "{v0} 已存在，是否覆盖？", [file.name]),
          default: false
        }
      ]);

      if (!overwrite) {
        console.log(chalk.gray(wizardText(locale, "  跳过 {v0}", [file.name])));
        continue;
      }
    }

    await fs.writeFile(filePath, file.template);
    console.log(chalk.green(wizardText(locale, "  ✓ 创建 {v0} - {v1}", [file.name, file.description])));
  }
}

export const setupCommand = new Command('setup')
  .description('交互式配置向导 / Interactive configuration wizard')
  .option('--locale <locale>', '项目语言 / Project language (zh-CN, en)', validateProjectLocale)
  .option('--global', '在 ~/.zhin 初始化并配置全局实例 / Initialize and configure ~/.zhin')
  .option('--bootstrap', '仅配置引导文件 / Configure bootstrap files only')
  .option('--database', '仅配置数据库 / Configure the database only')
  .option('--adapters', '仅配置适配器 / Configure adapters only')
  .option('--ai', '仅配置 AI / Configure AI only')
  .option('--decisions', '配置可选 TypeSafe Jev 决策服务（需要已有 AI 配置） / Configure optional TypeSafe Jev decisions (requires AI)')
  .action(async (options) => {
    let locale = resolveLocale(options.locale);
    const cwd = options.global
      ? await ensureGlobalHome({ install: false })
      : process.cwd();
    const pkgPath = path.join(cwd, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      if (options.global) {
        logger.error(wizardText(locale, "无法初始化全局实例目录 {v0}", [globalZhinHome()]));
      } else {
        logger.error(wizardText(locale, "当前目录不是有效的 Zhin 项目，请先使用 {v0} 创建项目，或 zhin setup --global", [CREATE_PROJECT_COMMAND]));
      }
      process.exit(1);
    }

    // 加载现有配置
    const configFile = findConfigFile(cwd);
    let config: any = {};
    let configPath = path.join(cwd, 'zhin.config.yml');

    if (configFile) {
      configPath = path.join(cwd, configFile);
      try {
        config = await readConfig(configPath);
        locale = resolveLocale(options.locale ?? config.locale);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      console.log(chalk.gray(wizardText(locale, "已加载配置文件: {v0}\n", [configFile])));
    } else {
      console.log(chalk.yellow(wizardText(locale, "未找到配置文件，将创建 zhin.config.yml\n")));
      config = {
        configVersion: 2,
        log_level: 'INFO',
        disable_plugins: [],
        // plugins maps stable instance aliases to packages.
        plugins: {}
      };
    }

    if (options.global) {
      console.log(chalk.bold.cyan(wizardText(locale, "\n🌐 Zhin 全局实例（{v0}）\n", [globalZhinHome()])));
    }

    console.log(chalk.bold.cyan(wizardText(locale, "\n🚀 Zhin 配置向导\n")));

    try {
      readPluginConfigurationMap(config, configFile ?? 'zhin.config.yml');
      const wizardOptions: InitOptions = { ...(options.locale === undefined ? {} : { locale: options.locale }) };
      const configBefore = JSON.stringify(config);

      if (options.bootstrap || (!options.database && !options.adapters && !options.ai && !options.decisions)) {
        await setupBootstrapFiles(cwd, locale);
      }

      if (options.database || (!options.bootstrap && !options.adapters && !options.ai && !options.decisions)) {
        wizardOptions.database = await configureDatabaseOptions(locale);
      }

      if (options.adapters || (!options.bootstrap && !options.database && !options.ai && !options.decisions)) {
        wizardOptions.adapters = await configureAdapters(locale);
      }

      if (options.ai || (!options.bootstrap && !options.database && !options.adapters && !options.decisions)) {
        wizardOptions.ai = await configureAI(locale);
      }

      finalizeWizardOptions(wizardOptions);
      applyWizardOptionsToConfig(config, wizardOptions, locale);

      let decisions: Awaited<ReturnType<typeof configureTypeSafeDecisions>> | undefined;
      if (options.decisions) {
        decisions = await configureTypeSafeDecisions(config, locale);
        applyTypeSafeDecisionsToConfig(config, decisions);
      }

      // Candidate validation and the original source revision precede env/dependency writes.
      const configTransaction = await prepareConfigSave(configPath, config);
      await appendWizardEnvVars(cwd, wizardOptions.adapters, wizardOptions.ai, wizardOptions.database, locale);
      if (decisions) {
        await saveTypeSafeSetupDependencies(cwd, decisions);
        console.log(chalk.gray(options.global
          ? wizardText(locale, "  ✓ 已配置 TypeSafe 决策服务；稍后自动安装全局实例依赖。")
          : wizardText(locale, "  ✓ 已配置 TypeSafe 决策服务；运行 pnpm install 后启动。")));
      }

      const deps = collectWizardDependencies(wizardOptions);
      const depsChanged = await mergeDependenciesIntoPackageJson(cwd, deps);
      const featuresChanged = await mergeFeaturesIntoPackageJson(cwd, collectWizardFeatures(wizardOptions));
      if (depsChanged || featuresChanged) {
        console.log(chalk.gray(options.global
          ? wizardText(locale, "  ✓ 已更新 package.json 依赖/features 清单，稍后自动安装全局实例依赖。")
          : wizardText(locale, "  ✓ 已更新 package.json 依赖/features 清单，请运行 pnpm install")));
        if (wizardOptions.ai?.enabled) {
          console.log(chalk.gray(wizardText(locale, "    AI 栈: {v0}", [formatAIDependencyHint(wizardOptions.ai.agentProvider)])));
        }
      }

      if (wizardOptions.adapters) {
        const notes = getAdapterSetupNotes(wizardOptions.adapters, locale);
        if (notes.length > 0) {
          console.log('');
          console.log(chalk.gray(wizardText(locale, "  适配器后续步骤：")));
          for (const note of notes) {
            console.log(chalk.gray(`    • ${note}`));
          }
        }
      }

      // 保存配置：仅在配置实际有变更时落盘（--bootstrap 等组合不再静默跳过）
      const configChanged = JSON.stringify(config) !== configBefore;
      if (configChanged) {
        await configTransaction?.commit();
        console.log('');
        console.log(chalk.bold.green(wizardText(locale, "✅ 配置已保存")));
        console.log(chalk.gray(wizardText(locale, "配置文件: {v0}", [formatDisplayPath(configPath)])));
      }

      if (wizardOptions.database && !['sqlite', 'memory'].includes(wizardOptions.database.dialect)) {
        console.log('');
        console.log(chalk.gray(wizardText(locale, "数据库连接参数已写入 {v0}，配置文件仅保留环境变量引用。", [formatDisplayPath(path.join(cwd, '.env'))])));
        console.log(chalk.gray(options.global
          ? wizardText(locale, "启动前在 {v0} 运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。", [formatDisplayPath(cwd)])
          : wizardText(locale, "启动前运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。")));
      }

      if (options.global) {
        console.log('');
        console.log(chalk.gray(wizardText(locale, "正在安装全局实例依赖…")));
        installGlobalHomeDeps(cwd);
      }

      console.log('');
      console.log(chalk.cyan(options.global
        ? wizardText(locale, "💡 提示: 任意目录运行 \"zhin runtime start\" 启动全局实例")
        : wizardText(locale, "💡 提示: 运行 \"zhin dev\" 启动开发服务器")));
    } catch (error: unknown) {
      logger.error(wizardText(locale, "配置失败: {v0}", [error instanceof Error ? error.message : String(error)]));
      process.exit(1);
    }
  });
