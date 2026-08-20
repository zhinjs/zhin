import { definePlugin } from 'zhin.js';
import { getRepeaterEngine } from './src/engine.js';

export default definePlugin({
  name: 'repeater',
  metadata: {
    displayName: 'Repeater',
  },
  setup(context) {
    const engine = getRepeaterEngine();
    context.lifecycle.add(() => engine.dispose());
  },
});
