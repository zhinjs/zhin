import { wizardText } from './messages.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { updateDotenvFile } from '@zhin.js/runtime';
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
  // Runtime chat may already live in the database; startup files are not its authority.
  return isAiEnabledInConfig(config);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** An explicitly requested optional integration. Existing AI configuration is preserved. */
export async function configureTypeSafeDecisions(config: Readonly<Record<string, unknown>>, locale: 'zh-CN' | 'en' = 'zh-CN', proposal: unknown = {}): Promise<TypeSafeSetupConfig> {
  if (!hasChatAgent(config)) throw new Error(wizardText(locale, "先运行 zhin setup --ai 配置聊天模型，再运行 zhin setup --decisions。Jev 决策模型不能替代聊天模型。"));
  console.log(chalk.blue(wizardText(locale, "\nTypeSafe Jev：选择 Agent / Skill / Tool 的可选决策服务。")));
  console.log(chalk.gray(wizardText(locale, "shadow 仅记录建议，不改变已有行为；active 启用推荐。审核默认关闭。调用会向外部服务发送经过权限过滤的请求与候选描述。")));
  const answers = await inquirer.prompt([
    { type: 'input', name: 'instanceKey', message: wizardText(locale, "决策插件实例名"), default: 'typesafe', validate: (value: string) => /^[a-z][a-z0-9-]*$/.test(value) || wizardText(locale, "使用小写字母、数字和连字符，字母开头") },
    { type: 'password', name: 'apiKey', message: wizardText(locale, "TypeSafe API Key（仅写入 .env）"), mask: '*', validate: (value: string) => value.trim().length > 0 || wizardText(locale, "请输入 API Key") },
    { type: 'input', name: 'model', message: wizardText(locale, "Jev 模型（生产校准后建议固定版本）"), default: 'jev-latest', validate: (value: string) => value.trim().length > 0 || wizardText(locale, "请输入模型名称") },
    { type: 'select', name: 'mode', message: wizardText(locale, "Skill / Tool 推荐运行方式"), default: 'shadow', choices: [ { name: wizardText(locale, "shadow：观察建议，评估后再启用"), value: 'shadow' }, { name: wizardText(locale, "active：启用推荐，权限仍由 Zhin 校验"), value: 'active' } ] },
  ]);
  const reference = record(record(record(proposal).accounts)[answers.instanceKey]).auth;
  const source = record(reference).source;
  const existingVariable = typeof source === 'string' ? /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/.exec(source)?.[1] : undefined;
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
export function applyTypeSafeDecisionsToConfig(input: Readonly<{
  config: Record<string, unknown>; setup: TypeSafeSetupConfig; plan?: unknown;
}>): Record<string, unknown> {
  const { config, setup } = input;
  if (!hasChatAgent(config)) throw new Error('TypeSafe decisions require existing AI configuration; run zhin setup --ai first.');
  if (!/^[a-z][a-z0-9-]*$/.test(setup.instanceKey) || !setup.model.trim() || !setup.apiKey.trim()) throw new Error('Invalid TypeSafe setup configuration.');
  const plugins = clonePluginConfigurationMap(config), existing = record(plugins[setup.instanceKey]);
  if (['apiKey', 'model', 'timeoutMs', 'maxRetries'].some(key => Object.hasOwn(existing, key))) throw new Error('Legacy TypeSafe configuration requires explicit migration');
  const ai = record(config.ai);
  if (Object.hasOwn(ai, 'decisions')) throw new Error('Legacy decision configuration requires explicit migration');
  const plan = record(input.plan), services = record(plan.services), accounts = record(plan.accounts), profiles = record(plan.profiles), purposes = record(plan.purposes);
  const previousDecisions = record(purposes.decisions), previousService = record(services[setup.instanceKey]);
  const driver = { id: 'typesafe', owner: `root/${setup.instanceKey}`, contractVersion: '1' };
  if (Object.keys(previousService).length && JSON.stringify(previousService.driver) !== JSON.stringify(driver)) throw new Error('Decision service alias belongs to another Driver');
  const model = setup.model.trim(), profile = `${setup.instanceKey}:${model}`;
  const next = { ...plan, version: 1,
    services: { ...services, [setup.instanceKey]: { ...previousService, driver, models: { ...record(previousService.models), [model]: { id: model, kinds: ['decision'], protocol: 'typesafe-system-one' } } } },
    accounts: { ...accounts, [setup.instanceKey]: { service: setup.instanceKey, auth: { method: 'api-key', source: `env://${envVariable(setup)}` } } },
    profiles: { ...profiles, [profile]: { account: setup.instanceKey, model, parameters: { timeoutMs: 10000, maxRetries: 2 } } },
    purposes: { ...purposes, decisions: {
      ...previousDecisions,
      skills: { ...record(previousDecisions.skills), profile, mode: setup.mode },
      tools: { ...record(previousDecisions.tools), profile, mode: setup.mode },
      agents: previousDecisions.agents ?? { mode: 'off' },
      memory: previousDecisions.memory ?? { mode: 'off' },
      approval: previousDecisions.approval ?? { mode: 'off' },
    } },
  };
  // Registration is checked before publishing the new draft or writing a key.
  setPluginInstanceConfig(config, { instanceKey: setup.instanceKey, package: TYPESAFE_DECISION_PACKAGE }, existing);
  return next;
}

export async function saveTypeSafeSetupDependencies(projectDir: string, setup: TypeSafeSetupConfig): Promise<void> {
  const variable = envVariable(setup);
  await mergeDependenciesIntoPackageJson(projectDir, { [TYPESAFE_DECISION_PACKAGE]: '^1.0.0' });
  const envPath = path.join(projectDir, '.env');
  // The atomic writer keeps an existing file's mode. Restrict existing files before
  // adding credentials; Windows access control is not POSIX file modes.
  if (await fs.pathExists(envPath) && process.platform !== 'win32') await fs.chmod(envPath, 0o600);
  await updateDotenvFile(envPath, previous => mergeEnvText(previous, `${variable}=${formatEnvValue(setup.apiKey)}\n`));
}

/** Local checks only; never sends a paid API request or returns credential values. */
export function diagnoseDecisionConfig(input: Readonly<{ config: Readonly<Record<string, unknown>>; packageJson: unknown; plan?: unknown; locale?: 'zh-CN' | 'en' }>): string[] {
  const { config, packageJson, locale = 'zh-CN' } = input;
  const ai = record(config.ai);
  if (Object.hasOwn(ai, 'decisions')) return [locale === 'en' ? 'Legacy ai.decisions requires explicit migration.' : '旧 ai.decisions 需要显式迁移。'];
  const plan = record(input.plan), decisions = record(record(plan.purposes).decisions), issues: string[] = [];
  const taskNames = ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'];
  const message = (value: string, args: readonly unknown[] = []) => wizardText(locale, value, args).replaceAll('ai.decisions', 'ai.plan.yml:purposes.decisions');
  if (Object.keys(decisions).some(key => !taskNames.includes(key))) issues.push(message('ai.decisions 含有未知配置字段。'));
  for (const name of taskNames) {
    if (!Object.hasOwn(decisions, name)) continue;
    const task = record(decisions[name]);
    if (Object.keys(task).some(key => !['profile', 'mode', 'timeoutMs', 'minConfidence', 'topK', 'maxCandidates', 'maxSelections'].includes(key))) issues.push(message('ai.decisions.{v0} 含有未知配置字段。', [name]));
    if (!['off', 'shadow', 'active'].includes(String(task.mode))) issues.push(message('ai.decisions.{v0}.mode 必须是 off、shadow 或 active。', [name]));
    for (const field of ['timeoutMs', 'topK', 'maxCandidates', 'maxSelections']) {
      if (task[field] !== undefined && (!Number.isSafeInteger(task[field]) || Number(task[field]) <= 0 || field === 'timeoutMs' && Number(task[field]) > 2147483647)) issues.push(message('ai.decisions.{v0}.{v1} 必须是正整数。', [name, field]));
    }
    if (task.minConfidence !== undefined && (typeof task.minConfidence !== 'number' || !Number.isFinite(task.minConfidence) || task.minConfidence < 0 || task.minConfidence > 1)) issues.push(message('ai.decisions.{v0}.minConfidence 必须在 0 到 1 之间。', [name]));
    if (!['shadow', 'active'].includes(String(task.mode))) continue;
    const profile = record(record(plan.profiles)[String(task.profile)]), account = record(record(plan.accounts)[String(profile.account)]), service = record(record(plan.services)[String(account.service)]);
    const driver = record(service.driver);
    if (!Object.keys(profile).length || !Object.keys(account).length || !Object.keys(service).length) { issues.push(locale === 'en' ? 'Decision Profile reference is unresolved.' : '决策 Profile 引用未解析。'); continue; }
    if (typeof service.driver === 'string') continue; // Unique-name resolution belongs to the held runtime directory.
    const owner = driver.owner;
    if (typeof owner !== 'string' || !/^root(?:\/[a-z0-9][a-z0-9-]*)+$/.test(owner)) { issues.push(locale === 'en' ? 'Select an exact decision Driver owner.' : '请选择精确的决策 Driver owner。'); continue; }
    const key = owner.slice('root/'.length);
    if (key.includes('/')) continue;
    const declared = record(config.plugins);
    if (typeof declared[key] !== 'string') { issues.push(message('决策插件实例未在主配置 plugins 中声明。')); continue; }
    if (Array.isArray(config.disable_plugins) && config.disable_plugins.includes(key)) issues.push(message('绑定的决策插件已停用。'));
    const pkg = record(packageJson);
    if (declared[key] === TYPESAFE_DECISION_PACKAGE && !Object.hasOwn({ ...record(pkg.dependencies), ...record(pkg.devDependencies) }, TYPESAFE_DECISION_PACKAGE)) issues.push(message('package.json 缺少 @zhin.js/service-typesafe 依赖。'));
  }
  return [...new Set(issues)];
}
