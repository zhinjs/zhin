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
    super(
      `你在当前频道已有进行中的「${activeGameId}」对局，`
      + `请先结束它，再开始「${requestedGameId}」。`,
    );
    this.name = 'GameSessionConflictError';
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
