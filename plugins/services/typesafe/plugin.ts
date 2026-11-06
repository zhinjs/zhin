import { definePlugin } from 'zhin.js';
import { provideAiProviders } from '@zhin.js/ai/provider';
import { typeSafeProvider } from './src/provider.js';

export default definePlugin({
  name: 'typesafe',
  metadata: { displayName: 'TypeSafe AI' },
  setup(context) {
    provideAiProviders(context.resources, [typeSafeProvider]);
  },
});
