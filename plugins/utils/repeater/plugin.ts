import { definePlugin } from 'zhin.js';
import { RepeaterEngine } from './src/engine.js';
import { repeaterEngineToken } from './src/runtime.js';

export default definePlugin({
  name: 'repeater',
  metadata: {
    displayName: 'Repeater',
  },
  setup(context) {
    repeaterEngineToken.provide(context, () => new RepeaterEngine());
  },
});
