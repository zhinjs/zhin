import type { InitOptions } from '@zhin.js/scaffold-wizard';

/**
 * `create-zhin -y` 的 Stable 黄金路径：IM-only + Sandbox + Remote Console。
 *
 * AI/Ollama 走首跑成功后的 `zhin setup --ai` opt-in，避免本地模型前置条件阻塞新手。
 */
export function applyStableYesDefaults(options: InitOptions): void {
  if (!options.yes) return;

  options.database = undefined;
  options.devSkills = false;

  options.adapters = {
    packages: ['@zhin.js/adapter-sandbox'],
    plugins: ['@zhin.js/adapter-sandbox'],
    instances: [{
      package: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
      config: {
        endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }],
      },
    }],
    envVars: {},
  };

  options.ai = { enabled: false };
}
