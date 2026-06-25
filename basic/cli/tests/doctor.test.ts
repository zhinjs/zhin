import { describe, expect, it } from 'vitest';
import { applyConsoleConfigFixes, diagnoseConsoleConfig } from '../src/commands/doctor.js';

describe('doctor console diagnostics', () => {
  it('detects missing Console host, Sandbox, CORS, and token config', () => {
    const diagnosis = diagnoseConsoleConfig({ plugins: ['example'], http: {} });

    expect(diagnosis.missingHostPlugins).toEqual(['@zhin.js/host-router', '@zhin.js/host-api']);
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
    expect(config.plugins).toEqual([
      'example',
      '@zhin.js/host-router',
      '@zhin.js/host-api',
      '@zhin.js/adapter-sandbox',
    ]);
    expect(config.http).toMatchObject({
      port: 8086,
      token: '${HTTP_TOKEN}',
      corsOrigins: ['https://console.zhin.dev'],
    });
    expect(diagnosis).toEqual({
      missingHostPlugins: [],
      missingSandboxPlugin: false,
      missingConsoleOrigin: false,
      missingHttpToken: false,
    });
  });

  it('does not rewrite already healthy config', () => {
    const config: Record<string, unknown> = {
      plugins: ['@zhin.js/host-router', '@zhin.js/host-api', '@zhin.js/adapter-sandbox'],
      http: { token: '${HTTP_TOKEN}', corsOrigins: ['https://console.zhin.dev'] },
    };

    expect(applyConsoleConfigFixes(config)).toBe(false);
  });
});
