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
      // 对齐 examples/minimal-bot 的 Stable 黄金路径：命令保留 / 前缀（/hello）；
      // 无前缀文本落入 unmatched（AI 对话）路径。
      config: {
        commandPrefix: '/',
        endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }],
      },
    }],
    envVars: {},
  };

  options.ai = { enabled: false };
}
