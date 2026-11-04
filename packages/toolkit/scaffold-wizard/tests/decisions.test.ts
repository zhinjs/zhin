import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { vi } from 'vitest';
import inquirer from 'inquirer';
import { applyTypeSafeDecisionsToConfig, configureTypeSafeDecisions, diagnoseDecisionConfig, saveTypeSafeSetupDependencies, TYPESAFE_DECISION_PACKAGE } from '../src/decisions.js';

const setup = { instanceKey: 'typesafe', apiKey: 'private-key', model: 'jev-latest', mode: 'shadow' } as const;
function aiConfig(): Record<string, unknown> {
  return { configVersion: 2, ai: { enabled: true }, plugins: { sandbox: '@zhin.js/adapter-sandbox' }, sandbox: { endpoints: [] } };
}
function chatPlan() { return { version: 1, services: { chat: { driver: 'openai' } }, accounts: { chat: { service: 'chat', auth: { method: 'api-key' } } }, profiles: { chat: { account: 'chat', model: 'gpt-test' } }, purposes: { chat: { profile: 'chat' } } }; }
function manifest() { return { dependencies: { [TYPESAFE_DECISION_PACKAGE]: '^1.0.0' }, zhin: { plugins: [{ package: TYPESAFE_DECISION_PACKAGE, instanceKey: 'typesafe' }] } }; }

it('keeps completion settings, writes only an environment reference and starts recommendation in shadow', () => {
  const config = aiConfig();
  const plan = applyTypeSafeDecisionsToConfig({ config, setup, plan: chatPlan() });
  expect(plan).toMatchObject({ purposes: { chat: { profile: 'chat' }, decisions: { skills: { profile: 'typesafe:jev-latest', mode: 'shadow' }, tools: { mode: 'shadow' }, approval: { mode: 'off' } } } });
  expect(config.plugins).toMatchObject({ sandbox: '@zhin.js/adapter-sandbox', typesafe: TYPESAFE_DECISION_PACKAGE });
  expect(plan).toMatchObject({ accounts: { typesafe: { auth: { source: 'env://TYPESAFE_API_KEY' } } } });
  expect(config.ai).not.toHaveProperty('plan');
  expect(config.typesafe).toEqual({});
  expect(JSON.stringify(config)).not.toContain('private-key');
  expect(diagnoseDecisionConfig({ config, packageJson: manifest(), plan })).toEqual([]);
});

it('requires a configured completion Agent before asking for a key', async () => {
  const prompt = vi.spyOn(inquirer, 'prompt').mockRejectedValue(new Error('Unexpected interactive prompt'));
  try {
    await expect(configureTypeSafeDecisions({})).rejects.toThrow('zhin setup --ai');
    expect(prompt).not.toHaveBeenCalled();
  } finally { prompt.mockRestore(); }
});

it('saves manifest, optional dependency and env idempotently without touching unrelated configuration', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-decisions-'));
  try {
    await fs.writeJson(path.join(directory, 'package.json'), { dependencies: { 'zhin.js': '^1.1.0' }, zhin: { plugins: [{ package: 'other', instanceKey: 'other' }] } });
    const envPath = path.join(directory, '.env');
    await fs.writeFile(envPath, 'OTHER=preserved\n', { mode: 0o644 });
    await saveTypeSafeSetupDependencies(directory, setup);
    await saveTypeSafeSetupDependencies(directory, setup);
    const pkg = await fs.readJson(path.join(directory, 'package.json'));
    expect(pkg.dependencies).toMatchObject({ [TYPESAFE_DECISION_PACKAGE]: '^1.0.0', 'zhin.js': '^1.1.0' });
    expect(pkg.zhin.plugins).toHaveLength(1);
    const env = await fs.readFile(path.join(directory, '.env'), 'utf8');
    expect(env).toContain('OTHER=preserved');
    expect(env.match(/^TYPESAFE_API_KEY=/gm)).toHaveLength(1);
    expect(JSON.stringify(pkg)).not.toContain('private-key');
    if (process.platform !== 'win32') expect((await fs.stat(envPath)).mode & 0o777).toBe(0o600);
  } finally { await fs.remove(directory); }
});

it('refuses an instance-name collision before any dependency or credential write', () => {
  const config = aiConfig();
  config.plugins = { sandbox: '@zhin.js/adapter-sandbox', typesafe: 'other-package' };
  const before = structuredClone(config);
  expect(() => applyTypeSafeDecisionsToConfig({ config, setup, plan: chatPlan() })).toThrow('already belongs');
  expect(config).toEqual(before);
});

it('diagnoses missing and disabled bindings without reflecting credentials', () => {
  const config = aiConfig();
  const plan = applyTypeSafeDecisionsToConfig({ config, setup, plan: chatPlan() });
  expect(diagnoseDecisionConfig({ config, packageJson: {}, plan })).toContain('package.json 缺少 @zhin.js/service-typesafe 依赖。');
  config.disable_plugins = ['typesafe'];
  expect(diagnoseDecisionConfig({ config, packageJson: manifest(), plan })).toContain('绑定的决策插件已停用。');
  expect(JSON.stringify(diagnoseDecisionConfig({ config, packageJson: manifest(), plan }))).not.toContain('private-key');
});

it('allows an AI Host with database-managed chat and no startup binding', async () => {
  const prompt = vi.spyOn(inquirer, 'prompt').mockResolvedValue(setup);
  try {
    const result = await configureTypeSafeDecisions({ ai: { enabled: true } });
    expect(result.model).toBe(setup.model); expect(prompt).toHaveBeenCalledOnce();
  } finally { prompt.mockRestore(); }
});

it.each([
  { skill: { mode: 'active' } },
  { skills: { mode: 'off', minConfidance: 0.95 } },
])('diagnoses unknown configuration fields even when tasks are off', decisions => {
  const config = aiConfig();
  const plan = { purposes: { decisions } };
  expect(diagnoseDecisionConfig({ config, packageJson: manifest(), plan }).some(issue => issue.includes('未知配置字段'))).toBe(true);
});

it('writes credentials on Windows without relying on POSIX chmod', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-decisions-'));
  const chmod = vi.spyOn(fs, 'chmod');
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  try {
    await fs.writeJson(path.join(directory, 'package.json'), {});
    await fs.writeFile(path.join(directory, '.env'), 'OTHER=preserved\n');
    await saveTypeSafeSetupDependencies(directory, setup);
    expect(chmod).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(directory, '.env'), 'utf8')).toContain('OTHER=preserved');
  } finally {
    platform.mockRestore();
    chmod.mockRestore();
    await fs.remove(directory);
  }
});

it('accepts nested and numeric owner paths and all-off bindings without requiring a live resource', () => {
  const config = aiConfig();
  const plan = { purposes: { decisions: { skills: { mode: 'off' } } } };
  expect(diagnoseDecisionConfig({ config, packageJson: {}, plan })).toEqual([]);
});

it('preserves existing task policy settings on reconfiguration', () => {
  const config = aiConfig();
  const previous = { purposes: { decisions: { skills: { mode: 'active', minConfidence: 0.92 }, approval: { profile: 'existing-approved', mode: 'active', timeoutMs: 500 } } } };
  const plan = applyTypeSafeDecisionsToConfig({ config, setup, plan: previous });
  expect(plan).toMatchObject({ purposes: { decisions: { skills: { mode: 'shadow', minConfidence: 0.92 }, approval: { profile: 'existing-approved', mode: 'active', timeoutMs: 500 } } } });
});

it('separates credentials for independent provider instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-decisions-'));
  try {
    await fs.writeJson(path.join(directory, 'package.json'), { zhin: { plugins: [] } });
    await saveTypeSafeSetupDependencies(directory, setup);
    const second = { ...setup, instanceKey: 'second', apiKey: 'second-private-key' };
    await saveTypeSafeSetupDependencies(directory, second);
    const config = aiConfig();
    const plan = applyTypeSafeDecisionsToConfig({ config, setup: second, plan: chatPlan() });
    expect(plan).toMatchObject({ accounts: { second: { auth: { source: 'env://TYPESAFE_SECOND_API_KEY' } } } });
    const env = await fs.readFile(path.join(directory, '.env'), 'utf8');
    expect(env).toContain('TYPESAFE_API_KEY=private-key');
    expect(env).toContain('TYPESAFE_SECOND_API_KEY=second-private-key');
  } finally { await fs.remove(directory); }
});
