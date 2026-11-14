import { definePlugin } from 'zhin.js';
import type { NettoolsConfig } from './src/config.js';
import { nettoolsServiceStore } from './src/runtime.js';
import { NettoolsService } from './src/service.js';

export default definePlugin<NettoolsConfig>({
  name: 'nettools',
  metadata: {
    displayName: '网络工具',
    displayNameI18n: { 'zh-CN': '网络工具', en: 'Network Tools' },
  },
  setup(context) {
    nettoolsServiceStore.provide(context, new NettoolsService({ config: context.config.get() }));
  },
});
