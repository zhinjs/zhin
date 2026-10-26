export interface ActiveGameSession {
  readonly id: string;
  readonly channel_key: string;
}

export interface GameSessionProvider {
  readonly gameId: string;
  getActiveForUser(channelKey: string, userId: string): Promise<ActiveGameSession | null>;
  bindAvailability(availability: GameSessionAvailability): void;
}

export interface GameSessionAvailability {
  assertAvailable(
    requestedGameId: string,
    channelKey: string,
    userIds: readonly string[],
  ): Promise<void>;
}

export class GameSessionConflictError extends Error {
  constructor(
    readonly requestedGameId: string,
    readonly activeGameId: string,
    readonly sessionId: string,
    readonly userId: string,
  ) {
    super(gameMessages('zh-CN', 'conflict', { active: activeGameId, requested: requestedGameId }));
    this.name = 'GameSessionConflictError';
  }

  /** Format at the reply boundary; session admission has no current-user locale. */
  format(locale?: Locale): string {
    return gameMessages(locale, 'conflict', { active: this.activeGameId, requested: this.requestedGameId });
  }
}

/**
 * Immutable cross-game active-session index for one projected generation.
 */
export class GameSessionCoordinator implements GameSessionAvailability {
  readonly #providers: readonly GameSessionProvider[];

  constructor(providers: readonly GameSessionProvider[]) {
    this.#providers = Object.freeze([...providers]);
  }

  async assertAvailable(
    requestedGameId: string,
    channelKey: string,
    userIds: readonly string[],
  ): Promise<void> {
    for (const provider of this.#providers) {
      if (provider.gameId === requestedGameId) continue;
      for (const userId of new Set(userIds.filter(Boolean))) {
        const active = await provider.getActiveForUser(channelKey, userId);
        if (active) {
          throw new GameSessionConflictError(
            requestedGameId,
            provider.gameId,
            active.id,
            userId,
          );
        }
      }
    }
  }

}
import type { Locale } from '@zhin.js/plugin-runtime';
import { gameMessages } from './messages.js';
