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
import { findConfigFile, prepareConfigSave, readConfig } from '@zhin.js/gateway/project';
import { installSetupDependencies, recordOnboardingSteps, setupOnboardingDeps, type SetupStepOutcomes } from './setup-onboarding.js';
import {
  wizardText,
  configureDatabaseOptions,
  configureAdapters,
  buildDefaultAdapterSetup,
  configureAI,
  configureTypeSafeDecisions,
  applyTypeSafeDecisionsToConfig,
  saveTypeSafeSetupDependencies,
  getAdapterSetupNotes,
  applyWizardOptionsToConfig,
  appendWizardEnvVars, readAIPlanProposal, saveAIPlanProposal, materializeAIPlan, mergeAIPlanProposals,
  collectWizardDependencies,
  collectWizardFeatures,
  mergeDependenciesIntoPackageJson,
  mergeFeaturesIntoPackageJson,
  finalizeWizardOptions,
  formatAIDependencyHint,
  RECOMMENDED_AI_DEFAULTS,
  validateProjectLocale,
  type InitOptions,
} from '@zhin.js/scaffold-wizard';

function collectValues(value: string, previous: string[] = []): string[] {
  return previous.includes(value) ? previous : [...previous, value];
}

async function setupBootstrapFiles(cwd: string, locale: 'zh-CN' | 'en' = 'zh-CN', yes = false): Promise<void> {
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

    if (exists && yes) {
      console.log(chalk.gray(wizardText(locale, "  跳过 {v0}", [file.name])));
      continue;
    }
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
  .option('--adapter <name>', '非交互添加适配器（可重复） / Add an adapter non-interactively (repeatable)', collectValues)
  .option('--enable-ai', '非交互启用 AI（模型 Provider 之后在 Console 添加） / Enable AI non-interactively')
  .option('--skip-ai', '跳过 AI 引导步骤 / Skip the AI onboarding step')
  .option('--skip-adapters', '跳过适配器引导步骤 / Skip the adapters onboarding step')
  .option('--install', '立即在线安装所需依赖（与 Console 相同的白名单） / Install the dependencies now (Console allowlist)')
  .option('-y, --yes', '非交互：不提问，只执行参数指定的步骤 / Non-interactive: only the steps given by flags')
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

    const adapterValues: string[] = options.adapter ?? [];
    const nonInteractiveSteps = adapterValues.length > 0 || options.enableAi || options.skipAi || options.skipAdapters;
    if (adapterValues.length && options.skipAdapters || options.enableAi && options.skipAi) {
      logger.error(wizardText(locale, "--adapter/--enable-ai 不能与对应的 --skip-* 同时使用"));
      process.exit(1);
    }
    if (options.yes && (options.database || options.adapters || options.ai || options.decisions)) {
      logger.error(wizardText(locale, "--yes 不能与交互步骤（--database / --adapters / --ai / --decisions）同时使用"));
      process.exit(1);
    }
    const explicitSteps = options.bootstrap || options.database || options.adapters || options.ai || options.decisions || nonInteractiveSteps;
    // Without flags the full interactive wizard runs; `-y` alone runs nothing interactive.
    const all = !explicitSteps && !options.yes;
    const outcomes: SetupStepOutcomes = {};

    try {
      readPluginConfigurationMap(config, configFile ?? 'zhin.config.yml');
      const wizardOptions: InitOptions = { ...(options.locale === undefined ? {} : { locale: options.locale }) };
      const configBefore = JSON.stringify(config);

      if (options.bootstrap || all) {
        await setupBootstrapFiles(cwd, locale, options.yes === true);
      }

      if (options.database || all) {
        wizardOptions.database = await configureDatabaseOptions(locale);
        outcomes.database = 'done';
      }

      if (adapterValues.length) {
        wizardOptions.adapters = await buildDefaultAdapterSetup(adapterValues, locale);
      } else if (options.adapters || all) {
        wizardOptions.adapters = await configureAdapters(locale);
      }
      if (wizardOptions.adapters) outcomes.adapters = wizardOptions.adapters.instances.length ? 'done' : 'skipped';
      else if (options.skipAdapters) outcomes.adapters = 'skipped';

      if (options.enableAi) {
        // Providers are added later in Console (AI can start empty).
        const { sessions, context, agent } = RECOMMENDED_AI_DEFAULTS;
        wizardOptions.ai = { enabled: true, sessions, context, agent: { ...agent, execAllowlist: [...agent.execAllowlist] } };
      } else if (options.ai || all) {
        wizardOptions.ai = await configureAI(locale);
      }
      if (wizardOptions.ai) outcomes.ai = wizardOptions.ai.enabled ? 'done' : 'skipped';
      else if (options.skipAi) outcomes.ai = 'skipped';

      finalizeWizardOptions(wizardOptions);
      applyWizardOptionsToConfig(config, wizardOptions, locale);

      let decisionPlan: Record<string, unknown> | undefined;
      let decisions: Awaited<ReturnType<typeof configureTypeSafeDecisions>> | undefined;
      if (options.decisions) {
        const existingPlan = wizardOptions.ai?.enabled ? mergeAIPlanProposals(await readAIPlanProposal(cwd), materializeAIPlan(wizardOptions.ai)) : await readAIPlanProposal(cwd);
        decisions = await configureTypeSafeDecisions(config, locale, existingPlan);
        decisionPlan = applyTypeSafeDecisionsToConfig({ config, setup: decisions, plan: existingPlan });
      }

      // Candidate validation and the original source revision precede env/dependency writes.
      const configTransaction = await prepareConfigSave(configPath, config);
      await appendWizardEnvVars(cwd, wizardOptions.adapters, wizardOptions.ai, wizardOptions.database, locale);
      if (decisions) {
        await saveAIPlanProposal(cwd, decisionPlan!);
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

      const onboarding = setupOnboardingDeps.createService(cwd);
      await recordOnboardingSteps(onboarding, outcomes, setupOnboardingDeps.io);
      if (options.install && !options.global && Object.keys(deps).length) {
        console.log('');
        const report = await installSetupDependencies(onboarding, deps, setupOnboardingDeps.io, { root: cwd });
        if (report && !report.ok) process.exitCode = 1;
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
        ? wizardText(locale, "💡 提示: 任意目录运行 \"zhin start\" 启动全局实例")
        : wizardText(locale, "💡 提示: 运行 \"pnpm dev\" 启动开发服务器")));
    } catch (error: unknown) {
      logger.error(wizardText(locale, "配置失败: {v0}", [error instanceof Error ? error.message : String(error)]));
      process.exit(1);
    }
  });
