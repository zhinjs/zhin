import { wizardText } from './messages.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { formatEnvValue, mergeEnvText } from './env.js';
import { clonePluginConfigurationMap, mergeDependenciesIntoPackageJson, setPluginInstanceConfig } from './apply.js';
import { isAiEnabledInConfig } from './project-deps.js';

export const TYPESAFE_DECISION_PACKAGE = '@zhin.js/service-typesafe';
export interface TypeSafeSetupConfig {
  readonly instanceKey: string;
  readonly apiKey: string;
  readonly model: string;
  readonly mode: 'shadow' | 'active';
  readonly envVar?: string;
}
function hasChatAgent(config: Readonly<Record<string, unknown>>): boolean {
  if (!isAiEnabledInConfig(config)) return false;
  const binding = record(record(record(config.ai).agents).zhin);
  return typeof binding.provider === 'string' && !!binding.provider.trim()
    && typeof binding.model === 'string' && !!binding.model.trim();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** An explicitly requested optional integration. Existing AI configuration is preserved. */
export async function configureTypeSafeDecisions(config: Readonly<Record<string, unknown>>, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<TypeSafeSetupConfig> {
  if (!hasChatAgent(config)) throw new Error(wizardText(locale, "先运行 zhin setup --ai 配置聊天模型，再运行 zhin setup --decisions。Jev 决策模型不能替代聊天模型。"));
  console.log(chalk.blue(wizardText(locale, "\nTypeSafe Jev：选择 Agent / Skill / Tool 的可选决策服务。")));
  console.log(chalk.gray(wizardText(locale, "shadow 仅记录建议，不改变已有行为；active 启用推荐。审核默认关闭。调用会向外部服务发送经过权限过滤的请求与候选描述。")));
  const answers = await inquirer.prompt([
    { type: 'input', name: 'instanceKey', message: wizardText(locale, "决策插件实例名"), default: 'typesafe', validate: (value: string) => /^[a-z][a-z0-9-]*$/.test(value) || wizardText(locale, "使用小写字母、数字和连字符，字母开头") },
    { type: 'password', name: 'apiKey', message: wizardText(locale, "TypeSafe API Key（仅写入 .env）"), mask: '*', validate: (value: string) => value.trim().length > 0 || wizardText(locale, "请输入 API Key") },
    { type: 'input', name: 'model', message: wizardText(locale, "Jev 模型（生产校准后建议固定版本）"), default: 'jev-latest', validate: (value: string) => value.trim().length > 0 || wizardText(locale, "请输入模型名称") },
    { type: 'select', name: 'mode', message: wizardText(locale, "Skill / Tool 推荐运行方式"), default: 'shadow', choices: [ { name: wizardText(locale, "shadow：观察建议，评估后再启用"), value: 'shadow' }, { name: wizardText(locale, "active：启用推荐，权限仍由 Zhin 校验"), value: 'active' } ] },
  ]);
  const reference = record(clonePluginConfigurationMap(config)[answers.instanceKey]).apiKey;
  const existingVariable = typeof reference === 'string' ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(reference)?.[1] : undefined;
  return { ...answers, envVar: existingVariable ?? decisionKeyVariable(answers.instanceKey) };
}

function decisionKeyVariable(instanceKey: string): string {
  return instanceKey === 'typesafe' ? 'TYPESAFE_API_KEY' : `TYPESAFE_${instanceKey.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}
function envVariable(setup: TypeSafeSetupConfig): string {
  const name = setup.envVar ?? decisionKeyVariable(setup.instanceKey);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid TypeSafe environment variable name.');
  return name;
}

/** Plan data separately from writes so secrets cannot enter the configuration document. */
export function applyTypeSafeDecisionsToConfig(config: Record<string, unknown>, setup: TypeSafeSetupConfig): void {
  if (!hasChatAgent(config)) throw new Error('TypeSafe decisions require existing AI configuration; run zhin setup --ai first.');
  if (!/^[a-z][a-z0-9-]*$/.test(setup.instanceKey) || !setup.model.trim() || !setup.apiKey.trim()) throw new Error('Invalid TypeSafe setup configuration.');
  const plugins = clonePluginConfigurationMap(config);
  const existing = record(plugins[setup.instanceKey]);
  setPluginInstanceConfig(config, { instanceKey: setup.instanceKey, package: TYPESAFE_DECISION_PACKAGE }, { ...existing, apiKey: '${' + envVariable(setup) + '}', model: setup.model.trim(), timeoutMs: 10000, maxRetries: 2, enabled: true });
  const ai = record(config.ai);
  const previousDecisions = record(ai.decisions);
  config.ai = { ...ai, decisions: {
    ...previousDecisions,
    provider: `root/${setup.instanceKey}`,
    skills: { ...record(previousDecisions.skills), mode: setup.mode },
    tools: { ...record(previousDecisions.tools), mode: setup.mode },
    agents: previousDecisions.agents ?? { mode: 'off' },
    memory: previousDecisions.memory ?? { mode: 'off' },
    approval: previousDecisions.approval ?? { mode: 'off' },
  } };
}

export async function saveTypeSafeSetupDependencies(projectDir: string, setup: TypeSafeSetupConfig): Promise<void> {
  const variable = envVariable(setup);
  await mergeDependenciesIntoPackageJson(projectDir, { [TYPESAFE_DECISION_PACKAGE]: '^1.0.0' });
  const envPath = path.join(projectDir, '.env');
  const envExists = await fs.pathExists(envPath);
  const previous = envExists ? await fs.readFile(envPath, 'utf8') : '';
  // writeFile's mode applies only when creating a file. Restrict existing files
  // before adding credentials; Windows access control is not POSIX file modes.
  if (envExists && process.platform !== 'win32') await fs.chmod(envPath, 0o600);
  await fs.writeFile(envPath, mergeEnvText(previous, `${variable}=${formatEnvValue(setup.apiKey)}\n`), { mode: 0o600 });
}

/** Local checks only; never sends a paid API request or returns credential values. */
export function diagnoseDecisionConfig(config: Readonly<Record<string, unknown>>, packageJson: unknown, locale: 'zh-CN' | 'en' = 'zh-CN'): string[] {
  const ai = record(config.ai);
  if (!Object.hasOwn(ai, 'decisions')) return [];
  const decisions = record(ai.decisions);
  const issues: string[] = [];
  const taskNames = ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'];
  if (Object.keys(decisions).some(key => !['provider', ...taskNames].includes(key))) issues.push(wizardText(locale, "ai.decisions 含有未知配置字段。"));
  const provider = decisions.provider;
  if (typeof provider !== 'string' || !/^root(?:\/[a-z0-9][a-z0-9-]*)+$/.test(provider)) return [...issues, wizardText(locale, "ai.decisions.provider 必须是精确插件 owner，例如 root/typesafe。")];
  for (const name of taskNames) {
    if (!Object.hasOwn(decisions, name)) continue;
    const task = record(decisions[name]);
    if (Object.keys(task).some(key => !['mode', 'timeoutMs', 'minConfidence', 'topK', 'maxCandidates', 'maxSelections'].includes(key))) issues.push(wizardText(locale, "ai.decisions.{v0} 含有未知配置字段。", [name]));
    if (typeof task.mode !== 'string' || !['off', 'shadow', 'active'].includes(task.mode)) issues.push(wizardText(locale, "ai.decisions.{v0}.mode 必须是 off、shadow 或 active。", [name]));
    for (const field of ['timeoutMs', 'topK', 'maxCandidates', 'maxSelections']) {
      if (task[field] !== undefined && (!Number.isSafeInteger(task[field]) || Number(task[field]) <= 0 || field === 'timeoutMs' && Number(task[field]) > 2147483647)) issues.push(wizardText(locale, "ai.decisions.{v0}.{v1} 必须是正整数。", [name, field]));
    }
    if (task.minConfidence !== undefined && (typeof task.minConfidence !== 'number' || !Number.isFinite(task.minConfidence) || task.minConfidence < 0 || task.minConfidence > 1)) issues.push(wizardText(locale, "ai.decisions.{v0}.minConfidence 必须在 0 到 1 之间。", [name]));
  }
  if (!hasChatAgent(config)) issues.push(wizardText(locale, "决策服务需要已启用的 AI Agent；运行 zhin setup --ai。"));
  const enabled = taskNames.some(name => ['shadow', 'active'].includes(String(record(decisions[name]).mode)));
  if (!enabled) return issues;
  const key = provider.slice('root/'.length);
  // Nested Plugin owners are resolved from the actual runtime graph during activation.
  if (key.includes('/')) return issues;
  const pkg = record(packageJson);
  const declared = record(config.plugins);
  if (typeof declared[key] !== 'string') {
    issues.push(wizardText(locale, "决策插件实例未在主配置 plugins 中声明。"));
    return issues;
  }
  if (Array.isArray(config.disable_plugins) && config.disable_plugins.includes(key)) issues.push(wizardText(locale, "绑定的决策插件已停用。"));
  if (declared[key] === TYPESAFE_DECISION_PACKAGE) {
    const configForProvider = record(config[key]);
    if (configForProvider.enabled === false) issues.push(wizardText(locale, "绑定的 TypeSafe 插件已禁用。"));
    if (typeof configForProvider.apiKey !== 'string' || !configForProvider.apiKey.trim()) issues.push(wizardText(locale, "TypeSafe 插件缺少 apiKey 环境变量引用。"));
    if (!Object.hasOwn({ ...record(pkg.dependencies), ...record(pkg.devDependencies) }, TYPESAFE_DECISION_PACKAGE)) issues.push(wizardText(locale, "package.json 缺少 @zhin.js/service-typesafe 依赖。"));
  }
  return issues;
}
