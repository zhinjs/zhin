export interface GameEventSession {
  readonly id: string;
  readonly channel_key: string;
  readonly status: string;
  readonly updated_at: number;
  readonly adapter?: string;
  readonly endpoint?: string;
  readonly channel_type?: string;
  readonly channel_id?: string;
}

export interface GameOutcome {
  readonly userId: string;
  readonly userName?: string;
  readonly result: 'won' | 'lost' | 'draw' | 'aborted';
  readonly score?: number;
}

export interface GameEventMap {
  'game:start': {
    readonly gameId: string;
    readonly session: GameEventSession;
  };
  'game:end': {
    readonly gameId: string;
    readonly session: GameEventSession;
    readonly previousStatus: string;
    readonly outcomes: readonly GameOutcome[];
  };
  'turn:change': {
    readonly gameId: string;
    readonly session: GameEventSession;
    readonly previousTurn: unknown;
    readonly turn: unknown;
  };
  'session:timeout': {
    readonly gameId: string;
    readonly session: GameEventSession;
    readonly idleMs: number;
  };
}

export type GameEventName = keyof GameEventMap;
export type GameEventListener<K extends GameEventName> = (
  event: GameEventMap[K],
) => void | Promise<void>;

/**
 * Small async pub/sub used by game modules. Listener failures are isolated so a
 * notification adapter cannot roll back an already committed session update.
 */
export class GameEventBus {
  readonly #listeners = new Map<GameEventName, Set<GameEventListener<GameEventName>>>();

  on<K extends GameEventName>(name: K, listener: GameEventListener<K>): () => void {
    const listeners = this.#listeners.get(name) ?? new Set();
    listeners.add(listener as GameEventListener<GameEventName>);
    this.#listeners.set(name, listeners);
    return () => {
      listeners.delete(listener as GameEventListener<GameEventName>);
      if (listeners.size === 0) this.#listeners.delete(name);
    };
  }

  async emit<K extends GameEventName>(name: K, event: GameEventMap[K]): Promise<void> {
    const listeners = [...(this.#listeners.get(name) ?? [])];
    await Promise.allSettled(listeners.map((listener) => listener(event)));
  }

  clear(): void {
    this.#listeners.clear();
  }
}

export const gameEvents = new GameEventBus();
