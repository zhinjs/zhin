import { createToken } from 'zhin.js';
import {
  gameFeatureId,
  isGameIndex,
  type GameIndex,
  type RuntimeRegisteredGame,
} from '@zhin.js/game-kit';

export const gameIndexToken = createToken<GameIndex>(
  'zhin.game.index',
  'Game Hub registered game index',
);

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

export function inferPlayerBounds(game: RuntimeGameWithPlayers): {
  readonly minPlayers: number;
  readonly maxPlayers: number;
} {
  if (typeof game.minPlayers === 'number' && typeof game.maxPlayers === 'number') {
    return { minPlayers: game.minPlayers, maxPlayers: game.maxPlayers };
  }
  const rangeMatch = /(\d+)\s*[-~至]\s*(\d+)\s*人/u.exec(game.description);
  if (rangeMatch) {
    return {
      minPlayers: Number(rangeMatch[1]),
      maxPlayers: Number(rangeMatch[2]),
    };
  }
  if (game.id === 'roulette') return { minPlayers: 2, maxPlayers: 6 };
  if (game.id === 'ttt') return { minPlayers: 1, maxPlayers: 2 };
  return { minPlayers: 1, maxPlayers: 1 };
}

export function toGameCatalogEntry(game: RuntimeRegisteredGame): GameCatalogEntry {
  const { minPlayers, maxPlayers } = inferPlayerBounds(game);
  const quickStart = game.quickStart ? ` ${game.quickStart}` : '';
  return {
    id: game.id,
    name: game.title,
    icon: game.icon,
    aliases: game.aliases ?? [],
    minPlayers,
    maxPlayers,
    playerCountRange: minPlayers === maxPlayers ? `${minPlayers}` : `${minPlayers}-${maxPlayers}`,
    description: game.description,
    startCommand: `${game.commandPrefix}${quickStart}`,
  };
}
