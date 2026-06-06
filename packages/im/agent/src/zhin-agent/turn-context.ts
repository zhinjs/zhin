import { AsyncLocalStorage } from 'node:async_hooks';
import { TurnTracker } from './turn-tracker.js';

export interface TurnContextStore {
  turnId: string;
  tracker: TurnTracker;
}

const turnContextStorage = new AsyncLocalStorage<TurnContextStore>();

export function runInTurnContext<T>(
  turnId: string,
  tracker: TurnTracker,
  fn: () => Promise<T>,
): Promise<T> {
  return turnContextStorage.run({ turnId, tracker }, fn);
}

export function getActiveTurnContext(): TurnContextStore | undefined {
  return turnContextStorage.getStore();
}

export function getActiveTurnTracker(): TurnTracker | undefined {
  return turnContextStorage.getStore()?.tracker;
}
