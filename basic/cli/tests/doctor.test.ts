import { describe, expect, it, vi } from 'vitest';
import { applyConsoleConfigFixes, diagnoseConsoleConfig } from '@zhin.js/scaffold-wizard';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMissingEndpointFields, loadPluginSchemaJson } from '../src/utils/adapter-endpoints-check.js';

vi.mock('child_process', () => ({
  exec: (_command: string, callback: (error: null, result: { stdout: string; stderr: string }) => void) => callback(null, { stdout: '9.0.0', stderr: '' }),
}));

describe('doctor console diagnostics', () => {
  it.each([false, true])('keeps Console and Sandbox diagnostics when package.json is malformed (decisions: %s)', async decisions => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-malformed-package-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
    try {
      fs.writeFileSync(path.join(directory, 'package.json'), '{ invalid json');
      fs.writeFileSync(path.join(directory, 'zhin.config.json'), JSON.stringify({
        plugins: { sandbox: {} },
        http: { token: 'test-token', corsOrigins: ['https://console.zhin.dev'] },
        ...(decisions ? { ai: { decisions: { provider: 'root/typesafe', skills: { mode: 'off' } } } } : {}),
      }));
      const { doctorCommand } = await import('../src/commands/doctor.js');
      await expect(doctorCommand.parseAsync(['node', 'zhin'])).rejects.toThrow('doctor exited');
      const output = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(output).toContain('Sandbox 插件已启用');
      expect(output).toContain('CORS 已配置');
      expect(output).toContain('package.json');
      expect(output).not.toContain('无法读取配置以检查 Console');
      if (decisions) expect(output).toContain('无法读取 package.json 以检查决策插件绑定');
    } finally {
      cwd.mockRestore();
      log.mockRestore();
      exit.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects missing Sandbox, CORS, and token config', () => {
    const diagnosis = diagnoseConsoleConfig({ plugins: { example: {} }, http: {} });

    expect(diagnosis.missingSandboxPlugin).toBe(true);
    expect(diagnosis.missingConsoleOrigin).toBe(true);
    expect(diagnosis.missingHttpToken).toBe(true);
  });

  it('fills first-run Console and Sandbox config without dropping existing plugins', () => {
    const config: Record<string, unknown> = {
      plugins: { example: {} },
      http: { port: 8086 },
    };

    const changed = applyConsoleConfigFixes(config);
    const diagnosis = diagnoseConsoleConfig(config);

    expect(changed).toBe(true);
    expect(config.plugins).toEqual({ example: {}, sandbox: {} });
    expect(config.http).toMatchObject({
      port: 8086,
      token: '${HTTP_TOKEN}',
      corsOrigins: ['https://console.zhin.dev'],
    });
    expect(diagnosis).toEqual({
      missingSandboxPlugin: false,
      missingConsoleOrigin: false,
      missingHttpToken: false,
    });
  });

  it('does not rewrite already healthy config', () => {
    const config: Record<string, unknown> = {
      plugins: { sandbox: {} },
      http: { token: '${HTTP_TOKEN}', corsOrigins: ['https://console.zhin.dev'] },
    };

    expect(applyConsoleConfigFixes(config)).toBe(false);
  });

  it('does not repair legacy list-form plugins in the normal doctor path', () => {
    const config: Record<string, unknown> = { plugins: ['@zhin.js/adapter-sandbox'] };
    expect(() => applyConsoleConfigFixes(config))
      .toThrow(/plugins must be an object keyed by Plugin instanceKey/);
  });
});

describe('doctor adapter endpoints check', () => {
  const qqSchema = {
    properties: {
      endpoints: {
        items: { required: ['name', 'appid', 'secret'] },
      },
    },
  };

  it('指出 endpoint 缺少的必填字段（如 QQ 缺 appid）', () => {
    const issues = findMissingEndpointFields(qqSchema, {
      endpoints: [{ name: 'zhin', secret: 's' }],
    });

    expect(issues).toEqual([{ endpoint: 'zhin', missing: ['appid'] }]);
  });

  it('顶层字段可被 endpoint 继承', () => {
    const issues = findMissingEndpointFields(qqSchema, {
      appid: 'a',
      secret: 's',
      endpoints: [{ name: 'zhin' }],
    });

    expect(issues).toEqual([]);
  });

  it('schema 无 endpoints.required 或未声明 endpoints 时不检查', () => {
    expect(findMissingEndpointFields(null, { endpoints: [{ name: 'x' }] })).toEqual([]);
    expect(findMissingEndpointFields({ properties: {} }, { endpoints: [{}] })).toEqual([]);
    expect(findMissingEndpointFields(qqSchema, {})).toEqual([]);
  });

  it('loadPluginSchemaJson 从 node_modules 读取 @zhin.js/adapter-<key>/schema.json', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-schema-'));
    try {
      const pkgDir = path.join(cwd, 'node_modules', '@zhin.js', 'adapter-qq');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'schema.json'), JSON.stringify(qqSchema));

      expect(loadPluginSchemaJson(cwd, 'qq')).toEqual(qqSchema);
      expect(loadPluginSchemaJson(cwd, 'not-installed')).toBeNull();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
