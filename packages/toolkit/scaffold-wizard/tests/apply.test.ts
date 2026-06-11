import { describe, expect, it } from 'vitest';
import {
  applyWizardOptionsToConfig,
  finalizeWizardOptions,
} from '../src/apply.js';
import type { InitOptions } from '../src/types.js';

describe('apply wizard to config', () => {
  it('merges database, adapters, and ai into config', () => {
    const config: Record<string, unknown> = { plugins: ['example'], endpoints: [] };
    const options: InitOptions = {
      database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' },
      adapters: {
        packages: ['@zhin.js/adapter-telegram'],
        plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/adapter-telegram'],
        endpoints: [{ context: 'telegram', name: 'tg', polling: true, token: '${TELEGRAM_TOKEN}' }],
        envVars: { TELEGRAM_TOKEN: 'x' },
      },
      ai: { enabled: true, defaultProvider: 'ollama', providers: { ollama: { host: 'http://127.0.0.1:11434' } } },
    };

    finalizeWizardOptions(options);
    applyWizardOptionsToConfig(config, options);

    expect(config.inbox).toEqual({ enabled: true });
    expect(config.plugins).toContain('@zhin.js/adapter-telegram');
    expect(config.plugins).toContain('@zhin.js/host-router');
    expect(config.endpoints).toHaveLength(1);
    expect(config.ai).toMatchObject({ enabled: true, defaultProvider: 'ollama' });
  });
});
