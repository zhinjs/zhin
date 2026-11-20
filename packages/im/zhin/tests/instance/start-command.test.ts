import { describe, expect, it, vi } from 'vitest';
import { hasAgentConfiguration, warnLiteralConfigSecrets, warnUnsetConfigEnvPlaceholders } from '../../src/instance/start-command.js';

describe('start command Agent configuration boundary', () => {
  it('does not load the optional Agent Host for explicitly disabled sections', () => {
    expect(hasAgentConfiguration({ ai: { enabled: false } })).toBe(false);
    expect(hasAgentConfiguration({ ai: { enabled: true } })).toBe(true);
    expect(hasAgentConfiguration({ assistant: {} })).toBe(true);
  });

  it.each(['workroom', 'workrooms', 'remoteAgents', 'remote_mesh', 'remoteMesh'])(
    'rejects removed ai.%s before the disabled-Agent short circuit',
    (legacyKey) => {
      expect(() => hasAgentConfiguration({
        ai: { enabled: false, [legacyKey]: {} },
      })).toThrow(`ai.${legacyKey}`);
    },
  );
});

describe('start command literal secret warning (ADR 0057)', () => {
  it('logs one warning listing literal secret paths from Host and Plugin schemas, never the values', () => {
    const warn = vi.fn();
    const tree = new Map<string, unknown>([
      ['root', { id: 'root', instanceKey: 'root', children: ['root/demo'] }],
      ['root/demo', { id: 'root/demo', instanceKey: 'demo', parent: 'root', children: [],
        configSchema: { type: 'object', properties: { signing: { type: 'string', 'x-zhin-secret': true } } } }],
    ]);
    warnLiteralConfigSecrets({
      configVersion: 2,
      plugins: { demo: 'demo-plugin' },
      http: { token: 'literal-http-value' },
      database: { password: '${DB_PASSWORD}' },
      demo: { signing: 'literal-signing-value', label: 'visible', appSecret: 'literal-fallback-value' },
    }, { root: 'root', tree } as never, '/project/zhin.config.yml', { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('http.token');
    expect(message).toContain('demo.signing');
    expect(message).toContain('demo.appSecret');
    expect(message).toContain('zhin doctor --fix');
    expect(message).not.toMatch(/literal-.*-value|DB_PASSWORD|database\.password|visible/u);
  });

  it('stays silent when every secret is a ${VAR} reference', () => {
    const warn = vi.fn();
    warnLiteralConfigSecrets({ http: { token: '${HTTP_TOKEN}' } }, { root: 'root', tree: new Map() } as never, 'zhin.config.yml', { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('start command unset ${VAR} warning (#1250)', () => {
  const document = {
    configVersion: 2,
    plugins: { qq: '@zhin.js/adapter-qq', rss: 'rss-plugin' },
    disable_plugins: ['qq'],
    http: { token: '${HTTP_TOKEN}' },
    qq: { appid: '${QQ_APPID}', secret: '${QQ_SECRET}' },
    rss: { key: '${RSS_KEY}' },
  };

  it('skips the configuration block of a plugin instance listed in disable_plugins', () => {
    const warn = vi.fn();
    warnUnsetConfigEnvPlaceholders(document, () => undefined, 'zhin.config.yml', { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('${HTTP_TOKEN}');
    expect(message).toContain('${RSS_KEY}');
    expect(message).not.toMatch(/QQ_APPID|QQ_SECRET/u);
  });

  it('does not warn about references with a default', () => {
    const warn = vi.fn();
    warnUnsetConfigEnvPlaceholders({ http: { port: '${PORT:-8068}', token: '${HTTP_TOKEN:=}' }, x: { url: 'http://${HOST}/' } },
      () => undefined, 'zhin.config.yml', { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('${HOST}');
    expect(message).not.toMatch(/PORT|HTTP_TOKEN/u);
  });

  it('stays silent when only a disabled plugin references unset variables', () => {
    const warn = vi.fn();
    warnUnsetConfigEnvPlaceholders(document, name => (name === 'HTTP_TOKEN' || name === 'RSS_KEY' ? 'set' : undefined), 'zhin.config.yml', { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('instance http config resolution (#1250)', () => {
  it('expands http once, exactly like the gateway and the CLI', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadGatewayHttpConfig } = await import('@zhin.js/gateway/server');
    const { loadRuntimeEnvironmentLayers } = await import('@zhin.js/gateway/project');
    const { createConfigDocument } = await import('@zhin.js/runtime');
    const { resolveInstanceHttpConfig } = await import('../../src/instance/start-command.js');
    const root = await mkdtemp(join(tmpdir(), 'zhin-http-once-'));
    try {
      // `${B:-${C}}` with B unset expands to the text `${C}` (default up to the first `}`, then `}`);
      // a `.env` value containing `${X}` is a literal. A second pass would turn both into values.
      await writeFile(join(root, 'zhin.config.yml'),
        'configVersion: 2\nhttp:\n  token: "${HTTP_ONCE_TOKEN}"\n  base: "${HTTP_ONCE_B:-${HTTP_ONCE_C}}"\n');
      await writeFile(join(root, '.env'), 'HTTP_ONCE_TOKEN=lit${HTTP_ONCE_C}\nHTTP_ONCE_C=expanded-twice\n');
      const raw = (await createConfigDocument(join(root, 'zhin.config.yml')).read()).document;
      const layers = await loadRuntimeEnvironmentLayers(root, 'development');
      const instance = await resolveInstanceHttpConfig(raw, layers, 'development', root);
      const gateway = await loadGatewayHttpConfig(root, 'development');
      expect(instance).toEqual(gateway);
      expect(instance.token).toBe('lit${HTTP_ONCE_C}');
      expect(instance.apiBase).toBe('${HTTP_ONCE_C}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
