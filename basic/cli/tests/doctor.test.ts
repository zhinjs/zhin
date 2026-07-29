import { describe, expect, it } from 'vitest';
import { applyConsoleConfigFixes, diagnoseConsoleConfig } from '@zhin.js/scaffold-wizard';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMissingEndpointFields, loadPluginSchemaJson } from '../src/utils/adapter-endpoints-check.js';

describe('doctor console diagnostics', () => {
  it('detects missing Sandbox, CORS, and token config', () => {
    const diagnosis = diagnoseConsoleConfig({ plugins: ['example'], http: {} });

    expect(diagnosis.missingSandboxPlugin).toBe(true);
    expect(diagnosis.missingConsoleOrigin).toBe(true);
    expect(diagnosis.missingHttpToken).toBe(true);
  });

  it('fills first-run Console and Sandbox config without dropping existing plugins', () => {
    const config: Record<string, unknown> = {
      plugins: ['example'],
      http: { port: 8086 },
    };

    const changed = applyConsoleConfigFixes(config);
    const diagnosis = diagnoseConsoleConfig(config);

    expect(changed).toBe(true);
    // legacy host-api / host-router 插件栈已删除，不再写入配置
    expect(config.plugins).toEqual([
      'example',
      '@zhin.js/adapter-sandbox',
    ]);
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
      plugins: ['@zhin.js/adapter-sandbox'],
      http: { token: '${HTTP_TOKEN}', corsOrigins: ['https://console.zhin.dev'] },
    };

    expect(applyConsoleConfigFixes(config)).toBe(false);
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
