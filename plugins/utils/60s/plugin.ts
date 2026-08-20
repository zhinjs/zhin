import { definePlugin } from 'zhin.js';
import { DEFAULT_API_BASE, registerSixtySApiBase } from './src/runtime-deps.js';

export interface SixtySConfig {
  readonly apiBase?: string;
}

export default definePlugin<SixtySConfig>({
  name: 'sixty-s',
  metadata: {
    displayName: '60s API',
  },
  setup(context) {
    // 运行时读取配置：config patch 即时生效；卸载时 lifecycle 反注册，无 process.env 残留
    context.lifecycle.add(
      registerSixtySApiBase(() => context.config.get().apiBase?.trim() || DEFAULT_API_BASE),
    );
  },
});
