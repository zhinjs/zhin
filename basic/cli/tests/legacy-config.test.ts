import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_V2_MIGRATION_DOCS_URL,
  LegacyConfigError,
  assertNotLegacyConfig,
  detectLegacyConfig,
  formatLegacyConfigHint,
} from '../src/utils/legacy-config.js';
import { runConfigCheck } from '../src/utils/config-check.js';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  exec: (_command: string, callback: (error: null, result: { stdout: string; stderr: string }) => void) => callback(null, { stdout: '9.0.0', stderr: '' }),
}));

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function project(config: string, manifest: Record<string, unknown> = { name: 'demo', dependencies: { 'zhin.js': '^1.1.0' } }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-legacy-config-'));
  directories.push(directory);
  fs.writeFileSync(path.join(directory, 'zhin.config.yml'), config);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
  return directory;
}

const V1_CONFIG = 'http:\n  port: 8086\nplugins:\n  reminder:\n    token: synthetic-secret-v1-value\n';

function expectMigrationSteps(text: string): void {
  expect(text).toContain('v1');
  expect(text).toContain('configVersion: 2');
  expect(text).toContain('zhin stop');
  expect(text).toContain('zhin migrate instances --apply');
  expect(text).toContain(CONFIG_V2_MIGRATION_DOCS_URL);
  expect(text).not.toContain('synthetic-secret-v1-value');
}

describe('v1 config detection', () => {
  it('flags an unversioned config and legacy package mounts without exposing values', async () => {
    const root = project(V1_CONFIG, { name: 'demo', zhin: { plugins: [{ package: '@zhin.js/plugin-reminder', instanceKey: 'reminder' }] } });
    const detection = await detectLegacyConfig(root);
    expect(detection.legacy).toBe(true);
    expect(detection.configFile).toBe('zhin.config.yml');
    expect(detection.reasons).toHaveLength(2);
    expectMigrationSteps(formatLegacyConfigHint(detection));
  });

  it('accepts configVersion 2 projects and ignores unparsable configs', async () => {
    expect((await detectLegacyConfig(project('configVersion: 2\nplugins: {}\n'))).legacy).toBe(false);
    expect((await detectLegacyConfig(project('plugins: {broken: [}\n'))).legacy).toBe(false);
    await expect(assertNotLegacyConfig(project('configVersion: 2\nplugins: {}\n'))).resolves.toBeUndefined();
  });

  it('assertNotLegacyConfig throws a typed error carrying the steps', async () => {
    const failure = await assertNotLegacyConfig(project(V1_CONFIG)).catch(error => error);
    expect(failure).toBeInstanceOf(LegacyConfigError);
    expect(failure.code).toBe('ZHIN_LEGACY_CONFIG_V1');
    expectMigrationSteps(failure.message);
  });

  it('start refuses a v1 project with the migration steps before reading anything else', async () => {
    const root = project(V1_CONFIG);
    const { runStartCommand } = await import('../src/plugin-runtime/start-command.js');
    const failure = await runStartCommand({ root, args: [], writeOutput: () => undefined, writeError: () => undefined }).catch(error => error);
    expect(failure).toBeInstanceOf(LegacyConfigError);
    expectMigrationSteps(failure.message);
  });

  it('config check reports config.legacy_v1 instead of a parse error', async () => {
    const result = await runConfigCheck(project(V1_CONFIG), {});
    expect(result.issues.map(issue => issue.code)).toEqual(['config.legacy_v1']);
    expectMigrationSteps(result.issues[0].message);
    expect(result.issues[0].fixHint).toContain('zhin migrate instances --apply');
  });

  it('doctor shows the migration hint instead of a generic parse failure', async () => {
    const root = project(V1_CONFIG);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
    try {
      const { doctorCommand } = await import('../src/commands/doctor.js');
      await doctorCommand.parseAsync(['node', 'zhin']).catch(() => undefined);
      const output = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(output).toContain('配置版本');
      expectMigrationSteps(output);
      expect(output).not.toContain('解析失败');
    } finally {
      cwd.mockRestore(); log.mockRestore(); exit.mockRestore();
    }
  });
});
