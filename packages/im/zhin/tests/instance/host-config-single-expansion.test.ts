import { afterEach, describe, expect, it } from 'vitest';
import { resolveAiConfig } from '@zhin.js/agent/runtime';
import { createEnvStore } from '@zhin.js/runtime';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { resolveProtocolConfig } from '../../src/instance/protocol-host-installer.js';
import { resolveSpeechConfig } from '../../src/instance/speech-host-installer.js';

/**
 * #1250: the instance expands the host config once with its EnvStore (`.env` over the process
 * environment). The AI, Speech and protocol Hosts read that expanded document as is: a `.env`
 * value containing `${X}` text stays that text, even when `X` is set in the process environment.
 */
describe('host config is expanded once (AI / Speech / protocol Hosts)', () => {
  afterEach(() => { delete process.env.ZHIN_ONCE_INNER; });

  it('keeps `${X}` text a .env value holds', async () => {
    process.env.ZHIN_ONCE_INNER = 'second-pass';
    const store = createEnvStore(rootPluginId(), { name: 'development', mode: 'development', platform: 'node' }, {
      environments: { development: { ZHIN_ONCE_VALUE: 'lit${ZHIN_ONCE_INNER}' } },
    });
    const hostConfig = store.expandMissingAsEmpty({
      ai: { enabled: true, defaultProvider: '${ZHIN_ONCE_VALUE}' },
      speech: { stt: { apiKey: '${ZHIN_ONCE_VALUE}' } },
      http: { token: '${ZHIN_ONCE_VALUE}', publicUrl: 'https://example.invalid' },
      mcp: { label: '${ZHIN_ONCE_VALUE}' },
    });
    expect((await resolveAiConfig(hostConfig))?.defaultProvider).toBe('lit${ZHIN_ONCE_INNER}');
    expect((await resolveSpeechConfig(hostConfig))?.stt).toEqual({ apiKey: 'lit${ZHIN_ONCE_INNER}' });
    const protocol = await resolveProtocolConfig(hostConfig, {});
    expect(protocol.httpToken).toBe('lit${ZHIN_ONCE_INNER}');
    expect(protocol.mcp).toEqual({ label: 'lit${ZHIN_ONCE_INNER}' });
  });
});
