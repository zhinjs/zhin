import { definePlugin } from '@zhin.js/plugin-runtime';

/**
 * Plugin Runtime game hub — lists games registered via `registerRuntimeGame`.
 * Interactive hub menus are deferred; `/games` command shows help text.
 */
export default definePlugin({
  name: 'game-hub',
  metadata: {
    displayName: 'Game Hub',
  },
  setup() {},
});
