import { definePlugin } from 'zhin.js';
import { RepeaterEngine } from './src/engine.js';
import { repeaterEngineToken } from './src/runtime.js';
import { repeaterConfig } from './src/config.js';

export default definePlugin({
  name: 'repeater',
  config: repeaterConfig,
  metadata: {
    displayName: 'Repeater',
  },
  setup(context) {
    const engine = new RepeaterEngine();
    context.resources.provide(repeaterEngineToken, engine);
    return () => engine.dispose();
  },
});
