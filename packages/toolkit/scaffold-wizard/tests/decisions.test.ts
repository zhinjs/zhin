import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { vi } from 'vitest';
import inquirer from 'inquirer';
import { applyTypeSafeDecisionsToConfig, configureTypeSafeDecisions, diagnoseDecisionConfig, saveTypeSafeSetupDependencies, TYPESAFE_DECISION_PACKAGE } from '../src/decisions.js';

const setup = { instanceKey: 'typesafe', apiKey: 'private-key', model: 'jev-latest', mode: 'shadow' } as const;
function aiConfig(): Record<string, unknown> {
  return { ai: { enabled: true, agents: { zhin: { provider: 'openai', model: 'gpt-test' } } }, plugins: { sandbox: { endpoints: [] } } };
}
function manifest() { return { dependencies: { [TYPESAFE_DECISION_PACKAGE]: '^1.0.0' }, zhin: { plugins: [{ package: TYPESAFE_DECISION_PACKAGE, instanceKey: 'typesafe' }] } }; }

it('keeps completion settings, writes only an environment reference and starts recommendation in shadow', () => {
  const config = aiConfig();
  applyTypeSafeDecisionsToConfig(config, setup);
  expect(config.ai).toMatchObject({ enabled: true, agents: { zhin: { provider: 'openai', model: 'gpt-test' } }, decisions: { provider: 'root/typesafe', skills: { mode: 'shadow' }, tools: { mode: 'shadow' }, approval: { mode: 'off' } } });
  expect(config.plugins).toMatchObject({ sandbox: { endpoints: [] }, typesafe: { apiKey: '${TYPESAFE_API_KEY}' } });
  expect(JSON.stringify(config)).not.toContain('private-key');
  expect(diagnoseDecisionConfig(config, manifest())).toEqual([]);
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
    expect(pkg.zhin.plugins).toHaveLength(2);
    const env = await fs.readFile(path.join(directory, '.env'), 'utf8');
    expect(env).toContain('OTHER=preserved');
    expect(env.match(/^TYPESAFE_API_KEY=/gm)).toHaveLength(1);
    expect(JSON.stringify(pkg)).not.toContain('private-key');
    if (process.platform !== 'win32') expect((await fs.stat(envPath)).mode & 0o777).toBe(0o600);
  } finally { await fs.remove(directory); }
});

it('refuses an instance-name collision before writing secrets or dependencies', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-decisions-'));
  try {
    const pkg = { zhin: { plugins: [{ package: 'other', instanceKey: 'typesafe' }] } };
    await fs.writeJson(path.join(directory, 'package.json'), pkg);
    await expect(saveTypeSafeSetupDependencies(directory, setup)).rejects.toThrow('another package');
    expect(await fs.pathExists(path.join(directory, '.env'))).toBe(false);
    expect(await fs.readJson(path.join(directory, 'package.json'))).toEqual(pkg);
  } finally { await fs.remove(directory); }
});

it('diagnoses missing and disabled bindings without reflecting credentials', () => {
  const config = aiConfig();
  applyTypeSafeDecisionsToConfig(config, setup);
  expect(diagnoseDecisionConfig(config, {})).toEqual(['决策插件实例未在 package.json#zhin.plugins 唯一声明。']);
  config.plugins = { typesafe: { enabled: false, apiKey: 'private-key' } };
  expect(diagnoseDecisionConfig(config, manifest())).toContain('绑定的 TypeSafe 插件已禁用。');
  expect(JSON.stringify(diagnoseDecisionConfig(config, manifest()))).not.toContain('private-key');
});

it('requires an actual completion binding even when ai.enabled is true', async () => {
  const prompt = vi.spyOn(inquirer, 'prompt').mockRejectedValue(new Error('Unexpected interactive prompt'));
  try {
    await expect(configureTypeSafeDecisions({ ai: { enabled: true } })).rejects.toThrow('zhin setup --ai');
    expect(prompt).not.toHaveBeenCalled();
  } finally { prompt.mockRestore(); }
});

it.each([
  { provider: 'root/typesafe', skill: { mode: 'active' } },
  { provider: 'root/typesafe', skills: { mode: 'off', minConfidance: 0.95 } },
])('diagnoses unknown configuration fields even when tasks are off', decisions => {
  const config = aiConfig();
  config.ai = { ...(config.ai as object), decisions };
  expect(diagnoseDecisionConfig(config, manifest()).some(issue => issue.includes('未知配置字段'))).toBe(true);
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
  config.ai = { ...(config.ai as object), decisions: { provider: 'root/1service/typesafe', skills: { mode: 'off' } } };
  expect(diagnoseDecisionConfig(config, {})).toEqual([]);
});

it('preserves existing task policy settings on reconfiguration', () => {
  const config = aiConfig();
  config.ai = { ...(config.ai as object), decisions: { provider: 'root/typesafe', skills: { mode: 'active', minConfidence: 0.92 }, approval: { mode: 'active', timeoutMs: 500 } } };
  applyTypeSafeDecisionsToConfig(config, setup);
  expect(config.ai).toMatchObject({ decisions: { skills: { mode: 'shadow', minConfidence: 0.92 }, approval: { mode: 'active', timeoutMs: 500 } } });
});

it('separates credentials for independent provider instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-decisions-'));
  try {
    await fs.writeJson(path.join(directory, 'package.json'), { zhin: { plugins: [] } });
    await saveTypeSafeSetupDependencies(directory, setup);
    const second = { ...setup, instanceKey: 'second', apiKey: 'second-private-key' };
    await saveTypeSafeSetupDependencies(directory, second);
    const config = aiConfig();
    applyTypeSafeDecisionsToConfig(config, second);
    expect(config.plugins).toMatchObject({ second: { apiKey: '${TYPESAFE_SECOND_API_KEY}' } });
    const env = await fs.readFile(path.join(directory, '.env'), 'utf8');
    expect(env).toContain('TYPESAFE_API_KEY=private-key');
    expect(env).toContain('TYPESAFE_SECOND_API_KEY=second-private-key');
  } finally { await fs.remove(directory); }
});
