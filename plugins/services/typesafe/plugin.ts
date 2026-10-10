import { definePlugin } from 'zhin.js';
import { decisionProviderToken } from '@zhin.js/agent/runtime';
import { TypeSafeDecisionProvider, type TypeSafeDecisionConfig } from './src/decision-provider.js';

export default definePlugin<TypeSafeDecisionConfig>({
  name: 'typesafe',
  metadata: { displayName: 'TypeSafe AI' },
  setup(context) {
    const config = context.config.get();
    if (config.enabled === false) return;
    const provider = new TypeSafeDecisionProvider(config);
    context.resources.provide(decisionProviderToken, provider);
    context.lifecycle.add(() => provider.dispose());
  },
});
