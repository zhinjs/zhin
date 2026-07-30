import { createToken } from '@zhin.js/plugin-runtime';
import type { SessionService } from './session-service.js';

export const gameServicesToken = createToken<SessionService>(
  'zhin.game.dungeon-expedition.services',
);

export function resolveGameServices(
  context: { use<T>(token: typeof gameServicesToken): T },
): SessionService {
  return context.use(gameServicesToken) as SessionService;
}
