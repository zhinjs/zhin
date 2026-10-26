import type { Locale } from 'zhin.js/i18n';
import { createToken, type Token } from 'zhin.js';
import { resolveRouletteConfig } from './config.js';
import type { RouletteFlow } from './game-flow.js';
import { resolveMutePenalty, type AdapterProjectionContext } from './mute-penalty.js';
import type { EndpointIdentity, RouletteServices } from './session-service.js';

/** Owner-scoped services consumed by discovered commands, middleware and the deadline job. */
export const rouletteServicesToken = createToken<RouletteServices>('zhin.game.roulette.services');

/** A command, middleware or schedule capability context. */
export interface RouletteCapabilityContext extends AdapterProjectionContext {
  readonly locale?: Locale;
  readonly formatCommand?: (path: string) => string | undefined;
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

/** `message.conversation.endpoint`, or an empty identity (no mute possible) when absent. */
export function endpointOf(input: unknown): EndpointIdentity {
  const empty = { adapter: '', id: '' };
  if (!input || typeof input !== 'object') return empty;
  const conversation = (input as { readonly conversation?: unknown }).conversation;
  if (!conversation || typeof conversation !== 'object') return empty;
  const endpoint = (conversation as { readonly endpoint?: unknown }).endpoint;
  if (!endpoint || typeof endpoint !== 'object') return empty;
  const identity = endpoint as { readonly adapter?: unknown; readonly id?: unknown };
  if (typeof identity.adapter !== 'string' || typeof identity.id !== 'string') return empty;
  return { adapter: identity.adapter, id: identity.id };
}
