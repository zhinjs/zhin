import { definePluginStore, type Token } from 'zhin.js';
import type { GameServices } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesStore = definePluginStore<GameServices>('zhin.game.text-adventure.services');
export const gameServicesToken = gameServicesStore;

export function resolveGameServices(context: { use<T>(token: Token<T>): T }): GameServices {
  return gameServicesStore.use(context);
}
