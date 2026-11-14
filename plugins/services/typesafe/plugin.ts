import { definePlugin } from 'zhin.js';
import { provideAiProviders } from '@zhin.js/ai/provider';
import { typeSafeProvider } from './src/provider.js';

export default definePlugin({
  name: 'typesafe',
  setup(context) {
    provideAiProviders(context.resources, [typeSafeProvider]);
  },
});
