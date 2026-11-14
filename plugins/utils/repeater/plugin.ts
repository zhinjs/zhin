import { definePlugin } from 'zhin.js';
import { RepeaterEngine } from './src/engine.js';
import { repeaterConfigToken, repeaterEngineToken } from './src/runtime.js';
import type { RepeaterConfig } from './src/config.js';

export default definePlugin({
  name: 'repeater',
  metadata: {
    displayName: 'Repeater',
    displayNameI18n: { 'zh-CN': '复读机', en: 'Repeater' },
  },
  setup(context) {
    repeaterEngineToken.provide(context, () => new RepeaterEngine());
    // `threshold` etc. may be overridden per adapter / endpoint / conversation (in place, no reload).
    repeaterConfigToken.provide(context, {
      configFor: message => context.configFor(message as Parameters<typeof context.configFor>[0]) as Readonly<RepeaterConfig>,
    });
  },
});
