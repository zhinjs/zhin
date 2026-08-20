import { createToken, type Token } from 'zhin.js/plugin-runtime';
import type { SessionServices } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesToken = createToken<SessionServices>('zhin.game.tic-tac-toe.services');

export function resolveGameServices(context: { use<T>(token: Token<T>): T }): SessionServices {
  return context.use(gameServicesToken);
}
