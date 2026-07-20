import { createToken } from '@zhin.js/plugin-runtime';
import type { GameServices } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesToken = createToken<GameServices>('zhin.game.text-adventure.services');

export function resolveGameServices(context: { use<T>(token: typeof gameServicesToken): T }): GameServices {
  return context.use(gameServicesToken) as GameServices;
}
