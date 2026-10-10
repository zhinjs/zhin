import { definePlugin } from 'zhin.js';
import { provideAgentDecisionProvider } from '@zhin.js/agent/runtime';
import { TypeSafeDecisionProvider, type TypeSafeDecisionConfig } from './src/decision-provider.js';

export default definePlugin<TypeSafeDecisionConfig>({
  name: 'typesafe',
  metadata: { displayName: 'TypeSafe AI' },
  setup(context) {
    const config = context.config.get();
    if (config.enabled === false) return;
    const provider = new TypeSafeDecisionProvider(config);
    provideAgentDecisionProvider(context.resources, provider);
    context.lifecycle.add(() => provider.dispose());
  },
});
