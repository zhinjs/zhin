import { createToken, type Token } from 'zhin.js';
import { resolveRouletteConfig } from './config.js';
import type { RouletteFlow } from './game-flow.js';
import { resolveMutePenalty } from './mute-penalty.js';
import type { RouletteServices } from './session-service.js';

/** Owner-scoped services consumed by discovered commands, middleware and the deadline job. */
export const rouletteServicesToken = createToken<RouletteServices>('zhin.game.roulette.services');

export interface RouletteCapabilityContext {
  use<T>(token: Token<T>): T;
  readonly config?: unknown;
}

export function resolveRouletteFlow(context: RouletteCapabilityContext): RouletteFlow {
  return {
    services: context.use(rouletteServicesToken),
    config: resolveRouletteConfig(context.config),
    penalty: resolveMutePenalty(context),
  };
}

/** Framework roles (master / trusted / user) of whoever sent the message. */
export function senderRolesOf(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return [];
  const sender = (input as { readonly sender?: unknown }).sender;
  if (!sender || typeof sender !== 'object') return [];
  const roles = (sender as { readonly roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === 'string');
}
