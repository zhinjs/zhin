import { describe, expect, it, vi } from 'vitest';
import { hasAgentConfiguration, warnLiteralConfigSecrets } from '../../src/instance/start-command.js';

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
