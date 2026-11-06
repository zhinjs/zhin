import { definePluginStore, type Token } from 'zhin.js';
import type { SessionService } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesStore = definePluginStore<SessionService>('zhin.game.blackjack.services');
export const gameServicesToken = gameServicesStore;

export function resolveGameServices(context: { use<T>(token: Token<T>): T }): SessionService {
  return gameServicesStore.use(context);
}
