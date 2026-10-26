import type { CapabilitySlot, Locale, PluginId } from '@zhin.js/plugin-runtime';
import type { GameDefinition, RuntimeRegisteredGame } from './game-definition.js';
import type { LeaderboardEntry, UserGameStats } from './game-records.js';
import { GameSessionCoordinator } from './session-coordinator.js';
import { gameMessages } from './messages.js';

export type GameCommandFormatter = (localPath: string, owner?: PluginId) => string | undefined;

export class GameIndex {
  readonly $projection = 'zhin.game-index/1' as const;
  readonly #definitions: readonly GameDefinition[];
  readonly #games: readonly RuntimeRegisteredGame[];
  readonly #definitionsByName: ReadonlyMap<string, GameDefinition>;
  readonly #gamesByName: ReadonlyMap<string, RuntimeRegisteredGame>;
  readonly #owners: ReadonlyMap<string, PluginId>;

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
    this.#owners = new Map(slots.map(slot => [slot.definition.id, slot.owner]));
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

  formatCommand(idOrAlias: string, formatter?: GameCommandFormatter): string | undefined {
    const game = this.get(idOrAlias);
    return game?.commandPath ? formatter?.(game.commandPath, this.#owners.get(game.id)) : undefined;
  }

  formatHelp(locale: Locale = 'zh-CN', formatter?: GameCommandFormatter): string {
    if (this.#games.length === 0) {
      return [
        gameMessages(locale, 'lobby'),
        '',
        gameMessages(locale, 'noGames'),
        gameMessages(locale, 'installGame'),
      ].join('\n');
    }
    const lines = [gameMessages(locale, 'lobby'), '', gameMessages(locale, 'loaded')];
    for (const game of this.#games) {
      const quickStart = game.quickStartI18n?.[locale] ?? game.quickStart;
      const start = quickStart ? ` ${quickStart}` : '';
      const command = this.formatCommand(game.id, formatter);
      lines.push(`${game.icon} **${game.titleI18n?.[locale] ?? game.title}**${command ? ` — \`${command}${start}\`` : ''}`);
      lines.push(`   ${game.descriptionI18n?.[locale] ?? game.description}`);
    }
    if (formatter) lines.push('', gameMessages(locale, 'startHint'));
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
    titleI18n: definition.titleI18n,
    icon: definition.icon,
    description: definition.description,
    descriptionI18n: definition.descriptionI18n,
    commandPrefix: definition.commandPrefix,
    commandPath: definition.commandPath,
    quickStart: definition.quickStart,
    quickStartI18n: definition.quickStartI18n,
    aliases: definition.aliases,
    menus: definition.menus,
  });
}

export function isGameIndex(value: unknown): value is GameIndex {
  return Boolean(value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.game-index/1');
}
