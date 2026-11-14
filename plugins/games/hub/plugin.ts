import {
  definePlugin,
  definePluginCapabilityGraph,
  pluginConsoleRpcToken,
} from 'zhin.js';
import { gameIndexStore } from './src/catalog.js';
import { createGameHubConsoleRpc } from './src/console.js';

/**
 * Plugin Runtime game hub — commands read the generation-owned GameIndex projection.
 * Interactive hub menus are deferred; `/games` command shows help text.
 */
export default definePlugin({
  name: 'game-hub',
  metadata: {
    displayName: 'Game Hub',
    displayNameI18n: { 'zh-CN': '游戏大厅', en: 'Game Hub' },
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [pluginConsoleRpcToken],
    injects: [gameIndexStore],
    features: {
      commands: ['games/[[action]]', '战绩', '排行/[[query]]'],
      skills: ['game-hub'],
      tools: ['skill/game-hub/game_catalog'],
      pages: ['index'],
    },
  }),
  setup(context) {
    return {
      consoleRpc: createGameHubConsoleRpc(gameIndexStore.get(context)),
    };
  },
});
