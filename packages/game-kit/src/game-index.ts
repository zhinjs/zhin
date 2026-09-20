import type { CapabilitySlot } from '@zhin.js/plugin-runtime';
import type { GameDefinition, RuntimeRegisteredGame } from './game-definition.js';
import type { LeaderboardEntry, UserGameStats } from './game-records.js';
import { GameSessionCoordinator } from './session-coordinator.js';

export class GameIndex {
  readonly $projection = 'zhin.game-index/1' as const;
  readonly #definitions: readonly GameDefinition[];
  readonly #games: readonly RuntimeRegisteredGame[];
  readonly #definitionsByName: ReadonlyMap<string, GameDefinition>;
  readonly #gamesByName: ReadonlyMap<string, RuntimeRegisteredGame>;

  constructor(slots: readonly Readonly<CapabilitySlot<GameDefinition>>[]) {
    const definitions = slots
      .map((slot) => slot.definition)
      .sort((a, b) => a.id.localeCompare(b.id));
    const definitionsByName = new Map<string, GameDefinition>();
    const gamesByName = new Map<string, RuntimeRegisteredGame>();
    const games = definitions.map((definition) => {
      const game = toRuntimeGame(definition);
      this.#claim(definitionsByName, definition.id, definition);
      this.#claim(gamesByName, game.id, game);
      for (const alias of definition.aliases ?? []) {
        this.#claim(definitionsByName, alias, definition);
        this.#claim(gamesByName, alias, game);
      }
      return game;
    });
    this.#definitions = Object.freeze(definitions);
    this.#games = Object.freeze(games);
    this.#definitionsByName = definitionsByName;
    this.#gamesByName = gamesByName;
    const coordinator = new GameSessionCoordinator(
      definitions.map((definition) => definition.sessions),
    );
    for (const definition of definitions) {
      definition.sessions.bindAvailability(coordinator);
    }
  }

  list(): readonly RuntimeRegisteredGame[] {
    return this.#games;
  }

  get(idOrAlias: string): RuntimeRegisteredGame | undefined {
    return this.#gamesByName.get(idOrAlias);
  }

  async getUserStats(userId: string, channelKey?: string): Promise<UserGameStats[]> {
    const stats = (await Promise.all(
      this.#definitions.map((game) => game.records.getUserStats(userId, channelKey)),
    )).flat();
    return stats.sort((a, b) => b.wins - a.wins || a.gameId.localeCompare(b.gameId));
  }

  async getLeaderboard(
    gameId: string,
    channelKey: string,
    limit = 10,
  ): Promise<LeaderboardEntry[]> {
    const game = this.#definitionsByName.get(gameId);
    return game ? game.records.getLeaderboard(game.id, channelKey, limit) : [];
  }

  formatHelp(): string {
    if (this.#games.length === 0) {
      return [
        '🎮 游戏大厅',
        '',
        '暂无已加载的游戏插件。',
        '安装并启用 `@zhin.js/plugin-guess-number` 等游戏包后重试。',
      ].join('\n');
    }
    const lines = ['🎮 游戏大厅', '', '已加载：'];
    for (const game of this.#games) {
      const start = game.quickStart ? ` ${game.quickStart}` : '';
      lines.push(`${game.icon} **${game.title}** — \`${game.commandPrefix}${start}\``);
      lines.push(`   ${game.description}`);
    }
    lines.push('', '发送对应命令开始；进行中可按各游戏说明直接回复。');
    return lines.join('\n');
  }

  #claim<T extends { readonly id: string }>(index: Map<string, T>, name: string, game: T): void {
    const existing = index.get(name);
    if (existing === game) return;
    if (existing) throw new Error(`Duplicate Game name "${name}" (${game.id} vs ${existing.id})`);
    index.set(name, game);
  }
}

function toRuntimeGame(definition: GameDefinition): RuntimeRegisteredGame {
  return Object.freeze({
    id: definition.id,
    title: definition.title,
    icon: definition.icon,
    description: definition.description,
    commandPrefix: definition.commandPrefix,
    quickStart: definition.quickStart,
    aliases: definition.aliases,
    menus: definition.menus,
  });
}

export function isGameIndex(value: unknown): value is GameIndex {
  return Boolean(value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.game-index/1');
}
