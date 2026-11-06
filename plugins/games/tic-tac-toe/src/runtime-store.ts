import { definePluginStore, type Token } from 'zhin.js';
import type { SessionServices } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesStore = definePluginStore<SessionServices>('zhin.game.tic-tac-toe.services');
export const gameServicesToken = gameServicesStore;

export function resolveGameServices(context: { use<T>(token: Token<T>): T }): SessionServices {
  return gameServicesStore.use(context);
}
