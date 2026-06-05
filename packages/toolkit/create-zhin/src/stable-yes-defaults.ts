import type { InitOptions } from '@zhin.js/scaffold-wizard';
import { RECOMMENDED_AI_DEFAULTS } from '@zhin.js/scaffold-wizard';

/**
 * `create-zhin -y` 与 monorepo examples/minimal-bot 对齐的 Stable 脚手架默认值。
 */
export function applyStableYesDefaults(options: InitOptions): void {
  if (!options.yes) return;

  options.database = undefined;
  options.devSkills = false;

  options.adapters = {
    packages: ['@zhin.js/adapter-sandbox'],
    plugins: ['@zhin.js/adapter-sandbox'],
    bots: [],
    envVars: {},
  };

  options.ai = {
    enabled: true,
    defaultProvider: 'ollama',
    providers: {
      ollama: { host: 'http://127.0.0.1:11434' },
    },
    agent: {
      ...RECOMMENDED_AI_DEFAULTS.agent,
      execSecurity: 'allowlist',
      execPreset: 'readonly',
    },
    trigger: {
      respondToAt: true,
      respondToPrivate: true,
      prefixes: ['ai:'],
      ignorePrefixes: [...RECOMMENDED_AI_DEFAULTS.trigger.ignorePrefixes],
      timeout: RECOMMENDED_AI_DEFAULTS.trigger.timeout,
    },
    memoryMcp: false,
  };
}
