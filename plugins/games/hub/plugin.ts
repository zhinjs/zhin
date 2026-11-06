import { definePlugin } from 'zhin.js';
import { createGameHubConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime game hub — commands read the generation-owned GameIndex projection.
 * Interactive hub menus are deferred; `/games` command shows help text.
 */
export default definePlugin({
  name: 'game-hub',
  metadata: {
    displayName: 'Game Hub',
  },
  setup() {
    return {
      consoleRpc: createGameHubConsoleRpc(),
    };
  },
});
