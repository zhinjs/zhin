import { definePlugin } from 'zhin.js';
import { provideAiProviders } from '@zhin.js/ai/provider';
import { typeSafeProvider } from './src/provider.js';

export default definePlugin({
  name: 'typesafe',
  metadata: { displayName: 'TypeSafe AI', displayNameI18n: { 'zh-CN': 'TypeSafe 决策服务', en: 'TypeSafe AI' } },
  setup(context) {
    provideAiProviders(context.resources, [typeSafeProvider]);
  },
});
