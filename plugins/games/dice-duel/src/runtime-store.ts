import { createToken } from '@zhin.js/plugin-runtime';
import type { SessionService } from './session-service.js';

/** Owner-scoped service consumed by discovered commands and middleware. */
export const gameServicesToken = createToken<SessionService>('zhin.game.dice-duel.services');

export function resolveGameServices(context: { use<T>(token: typeof gameServicesToken): T }): SessionService {
  return context.use(gameServicesToken) as SessionService;
}
