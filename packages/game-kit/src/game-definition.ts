import type { GameRecordPort } from './game-records.js';
import type { GameSessionProvider } from './session-coordinator.js';

const gameBrand = 'zhin.game/1' as const;

export interface RuntimeGameMenuAction {
  readonly id: string;
  readonly label: string;
}

export interface RuntimeRegisteredGame {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly description: string;
  readonly commandPrefix: string;
  readonly quickStart?: string;
  readonly aliases?: readonly string[];
  readonly menus?: readonly RuntimeGameMenuAction[];
}

export interface GameDefinition extends RuntimeRegisteredGame {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof gameBrand;
  readonly records: GameRecordPort;
  readonly sessions: GameSessionProvider;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addGame(localName: string, definition: GameDefinition): void;
  }
}

export function defineGame(
  game: RuntimeRegisteredGame,
  records: GameRecordPort,
  sessions: GameSessionProvider,
): Readonly<GameDefinition> {
  if (!game.id.trim()) throw new TypeError('Game id cannot be empty');
  if (!game.title.trim()) throw new TypeError('Game title cannot be empty');
  if (!game.commandPrefix.trim()) throw new TypeError('Game commandPrefix cannot be empty');
  return Object.freeze({
    ...game,
    aliases: game.aliases ? Object.freeze([...game.aliases]) : undefined,
    menus: game.menus
      ? Object.freeze(game.menus.map((menu) => Object.freeze({ ...menu })))
      : undefined,
    $feature: gameBrand,
    records,
    sessions,
  });
}

export function parseGameDefinition(value: unknown): GameDefinition {
  if (!value || typeof value !== 'object') throw invalidGame();
  const game = value as Partial<GameDefinition>;
  if (game.$feature !== gameBrand || typeof game.id !== 'string'
    || typeof game.title !== 'string' || typeof game.commandPrefix !== 'string'
    || !game.records || !game.sessions) {
    throw invalidGame();
  }
  return game as GameDefinition;
}

function invalidGame(): TypeError {
  return new TypeError('Game capability must be created with defineGame(...)');
}
