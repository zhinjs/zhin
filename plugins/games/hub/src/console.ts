import {
  definePluginConsoleRpc,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
} from 'zhin.js';
import type { GameIndex } from '@zhin.js/game-kit';
import {
  resolveGameIndex,
  toGameCatalogEntry,
} from './catalog.js';

export const GAME_HUB_CONSOLE_PAGE = 'index';
export const GAME_HUB_READ_PERMISSION = 'game-hub:read';

export interface GameHubConsoleGameRow {
  readonly id: string;
  readonly name: string;
  readonly aliases: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly description: string;
}

export interface GameHubConsoleStatus {
  readonly gameCount: number;
  readonly games: readonly GameHubConsoleGameRow[];
}

export function createGameHubConsoleRpc(
  fallbackIndex?: GameIndex,
): PluginConsoleRpc {
  return definePluginConsoleRpc({
    status: {
      page: GAME_HUB_CONSOLE_PAGE,
      requiredPermissions: [GAME_HUB_READ_PERMISSION],
      handler(_input, call: PluginConsoleRpcCall) {
        const index = resolveGameIndex(call.runtime as never) ?? fallbackIndex;
        const registered = index ? index.list() : [];
        const games = registered.map((game) => {
          const entry = toGameCatalogEntry(game);
          return {
            id: entry.id,
            name: entry.name,
            aliases: entry.aliases.join(', '),
            minPlayers: entry.minPlayers,
            maxPlayers: entry.maxPlayers,
            description: entry.description,
          };
        });
        return {
          gameCount: games.length,
          games,
        };
      },
    },
  });
}
