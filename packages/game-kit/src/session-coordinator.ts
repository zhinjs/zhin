export interface ActiveGameSession {
  readonly id: string;
  readonly channel_key: string;
}

export interface GameSessionProvider {
  readonly gameId: string;
  getActiveForUser(channelKey: string, userId: string): Promise<ActiveGameSession | null>;
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
 * Cross-game active-session index. Registrations form per-game stacks so HMR
 * can install a new generation before disposing the old one without a gap.
 */
export class GameSessionCoordinator {
  readonly #providers = new Map<string, GameSessionProvider[]>();

  register(provider: GameSessionProvider): () => void {
    const providers = this.#providers.get(provider.gameId) ?? [];
    providers.push(provider);
    this.#providers.set(provider.gameId, providers);
    return () => {
      const current = this.#providers.get(provider.gameId);
      if (!current) return;
      const index = current.lastIndexOf(provider);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#providers.delete(provider.gameId);
    };
  }

  async assertAvailable(
    requestedGameId: string,
    channelKey: string,
    userIds: readonly string[],
  ): Promise<void> {
    for (const [gameId, registrations] of this.#providers) {
      if (gameId === requestedGameId) continue;
      const provider = registrations[registrations.length - 1];
      if (!provider) continue;
      for (const userId of new Set(userIds.filter(Boolean))) {
        const active = await provider.getActiveForUser(channelKey, userId);
        if (active) {
          throw new GameSessionConflictError(
            requestedGameId,
            gameId,
            active.id,
            userId,
          );
        }
      }
    }
  }

  clear(): void {
    this.#providers.clear();
  }
}

export const gameSessionCoordinator = new GameSessionCoordinator();
