import { definePluginStore, type Token } from 'zhin.js';
import type { SessionService } from './session-service.js';

export const gameServicesStore = definePluginStore<SessionService>(
  'zhin.game.dungeon-expedition.services',
);
export const gameServicesToken = gameServicesStore;

export function resolveGameServices(
  context: { use<T>(token: Token<T>): T },
): SessionService {
  return gameServicesStore.use(context);
}
