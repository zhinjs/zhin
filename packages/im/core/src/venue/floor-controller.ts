export interface VenueFloorControllerOptions {
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface VenueFloorController {
  withFloor<T>(venueId: string, actor: string, fn: () => Promise<T> | T): Promise<T>;
  activeSpeaker(venueId: string): string | undefined;
  pendingCount(venueId: string): number;
}

interface VenueFloorQueueState {
  tail: Promise<void>;
  activeSpeaker: string | undefined;
  pendingCount: number;
  lastFinishedAt: number | undefined;
}

export function createVenueFloorController(options: VenueFloorControllerOptions = {}): VenueFloorController {
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep
    ?? ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  const queues = new Map<string, VenueFloorQueueState>();

  const getOrCreateState = (venueId: string): VenueFloorQueueState => {
    let state = queues.get(venueId);
    if (!state) {
      state = {
        tail: Promise.resolve(),
        activeSpeaker: undefined,
        pendingCount: 0,
        lastFinishedAt: undefined,
      };
      queues.set(venueId, state);
    }
    return state;
  };

  return Object.freeze({
    withFloor<T>(venueId: string, actor: string, fn: () => Promise<T> | T): Promise<T> {
      const state = getOrCreateState(venueId);
      state.pendingCount += 1;

      const prev = state.tail;
      let releaseTurn!: () => void;
      const currentTurn = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });
      state.tail = currentTurn;

      return (async () => {
        await prev;
        state.pendingCount -= 1;
        state.activeSpeaker = actor;
        try {
          if (minIntervalMs > 0 && state.lastFinishedAt !== undefined) {
            const elapsed = now() - state.lastFinishedAt;
            const waitMs = minIntervalMs - elapsed;
            if (waitMs > 0) {
              await sleep(waitMs);
            }
          }
          return await fn();
        } finally {
          state.lastFinishedAt = now();
          state.activeSpeaker = undefined;
          releaseTurn();
          if (state.pendingCount === 0 && state.tail === currentTurn && minIntervalMs === 0) {
            queues.delete(venueId);
          }
        }
      })();
    },

    activeSpeaker(venueId: string): string | undefined {
      return queues.get(venueId)?.activeSpeaker;
    },

    pendingCount(venueId: string): number {
      return queues.get(venueId)?.pendingCount ?? 0;
    },
  });
}
