import { definePluginStore } from 'zhin.js';
import {
  gameFeatureId,
  isGameIndex,
  type GameCommandFormatter,
  type GameIndex,
  type RuntimeRegisteredGame,
} from '@zhin.js/game-kit';
import type { Locale } from 'zhin.js/i18n';

export const gameIndexStore = definePluginStore<GameIndex>(
  'zhin.game.index',
  'Game Hub registered game index',
);
export const gameIndexToken = gameIndexStore;

export interface GameCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly aliases: readonly string[];
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly playerCountRange: string;
  readonly description: string;
  readonly startCommand: string;
}

type RuntimeGameWithPlayers = RuntimeRegisteredGame & {
  readonly minPlayers?: number;
  readonly maxPlayers?: number;
};

type ContextWithIndexLookup = {
  readonly project?: (feature: never) => unknown;
  readonly use?: (token: never) => unknown;
};

function isGameIndexLike(value: unknown): value is GameIndex {
  return isGameIndex(value)
    || (typeof value === 'object' && value !== null && typeof (value as GameIndex).list === 'function');
}

export function resolveGameIndex(context?: ContextWithIndexLookup): GameIndex | undefined {
  if (!context) return undefined;
  if (typeof context.use === 'function') {
    try {
      const fromToken = (context.use as (token: unknown) => unknown)(gameIndexToken);
      if (isGameIndexLike(fromToken)) return fromToken;
    } catch {
      // Fallback to feature projection when token is not bound.
    }
  }
  if (typeof context.project === 'function') {
    try {
      const projected = (context.project as (feature: unknown) => unknown)(gameFeatureId);
      if (isGameIndexLike(projected)) return projected;
    } catch {
      // Feature projection may not be available in all call contexts.
    }
  }
  return undefined;
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiDigitsOnly(value: string): boolean {
  if (value.length === 0 || value.length > 4) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isAsciiDigitCode(value.charCodeAt(i))) return false;
  }
  return true;
}

function parsePlayerRangeFromDescription(description: string): {
  readonly minPlayers: number;
  readonly maxPlayers: number;
} | undefined {
  const text = description.slice(0, 200);
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const personIdx = text.indexOf('人', searchFrom);
    if (personIdx <= 0) return undefined;
    searchFrom = personIdx + 1;
    const prefix = text.slice(0, personIdx).trimEnd();
    for (const sep of ['-', '~', '至']) {
      const sepIdx = prefix.lastIndexOf(sep);
      if (sepIdx <= 0) continue;
      const rightStr = prefix.slice(sepIdx + sep.length).trim();
      if (!isAsciiDigitsOnly(rightStr)) continue;
      const leftPrefix = prefix.slice(0, sepIdx).trimEnd();
      let leftStart = leftPrefix.length;
      while (leftStart > 0 && isAsciiDigitCode(leftPrefix.charCodeAt(leftStart - 1))) {
        leftStart -= 1;
      }
      const leftStr = leftPrefix.slice(leftStart);
      if (!isAsciiDigitsOnly(leftStr)) continue;
      return {
        minPlayers: Number(leftStr),
        maxPlayers: Number(rightStr),
      };
    }
  }
  return undefined;
}

export function inferPlayerBounds(game: RuntimeGameWithPlayers): {
  readonly minPlayers: number;
  readonly maxPlayers: number;
} {
  if (typeof game.minPlayers === 'number' && typeof game.maxPlayers === 'number') {
    return { minPlayers: game.minPlayers, maxPlayers: game.maxPlayers };
  }
  const parsedRange = parsePlayerRangeFromDescription(game.description);
  if (parsedRange) {
    return parsedRange;
  }
  if (game.id === 'roulette') return { minPlayers: 2, maxPlayers: 6 };
  if (game.id === 'ttt') return { minPlayers: 1, maxPlayers: 2 };
  return { minPlayers: 1, maxPlayers: 1 };
}

/**
 * How a catalog entry writes its start command. `index` + `formatCommand` are the same pair the
 * `games` command uses (`GameIndex.formatCommand`), so the entry carries the command as this
 * conversation sends it; without them the command is written without any prefix (#1250 第 82 批).
 */
export interface GameCatalogPresentation {
  readonly index?: Pick<GameIndex, 'formatCommand'>;
  readonly formatCommand?: GameCommandFormatter;
  readonly locale?: Locale;
}

export function toGameCatalogEntry(game: RuntimeRegisteredGame, presentation: GameCatalogPresentation = {}): GameCatalogEntry {
  const { minPlayers, maxPlayers } = inferPlayerBounds(game);
  const locale = presentation.locale;
  const quickStartText = (locale ? game.quickStartI18n?.[locale] : undefined) ?? game.quickStart;
  const quickStart = quickStartText ? ` ${quickStartText}` : '';
  const command = presentation.index?.formatCommand(game.id, presentation.formatCommand)
    ?? game.commandPath ?? game.id;
  return {
    id: game.id,
    name: game.title,
    icon: game.icon,
    aliases: game.aliases ?? [],
    minPlayers,
    maxPlayers,
    playerCountRange: minPlayers === maxPlayers ? `${minPlayers}` : `${minPlayers}-${maxPlayers}`,
    description: game.description,
    startCommand: `${command}${quickStart}`,
  };
}
