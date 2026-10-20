import { definePlugin } from 'zhin.js';
import type { NettoolsConfig } from './src/config.js';
import { nettoolsServiceToken } from './src/runtime.js';
import { NettoolsService } from './src/service.js';

export default definePlugin<NettoolsConfig>({
  name: 'nettools',
  metadata: {
    displayName: '网络工具',
  },
  setup(context) {
    const service = new NettoolsService({ config: context.config.get() });
    context.resources.provide(nettoolsServiceToken, service);
  },
});
