import type { Locale } from 'zhin.js/i18n';
import { definePluginStore, type Token } from 'zhin.js';
import { resolveRouletteConfig } from './config.js';
import type { RouletteFlow } from './game-flow.js';
import { resolveMutePenalty, type AdapterProjectionContext } from './mute-penalty.js';
import type { RouletteServices } from './session-service.js';

/** Owner-scoped services consumed by discovered commands, middleware and the deadline job. */
export const rouletteServicesStore = definePluginStore<RouletteServices>('zhin.game.roulette.services');
export const rouletteServicesToken = rouletteServicesStore;

/** A command, middleware or schedule capability context. */
export interface RouletteCapabilityContext extends AdapterProjectionContext {
  readonly locale?: Locale;
  readonly formatCommand?: (path: string) => string | undefined;
  use<T>(token: Token<T>): T;
  readonly config?: unknown;
}

export function resolveRouletteFlow(context: RouletteCapabilityContext): RouletteFlow {
  return {
    services: rouletteServicesStore.use(context),
    config: resolveRouletteConfig(context.config),
    penalty: resolveMutePenalty(context),
  };
}

const CHAT_ROLE_CHAIN = ['owner', 'admin', 'trusted'] as const;

/** Chat roles (ADR 0056, expanded: owner → owner / admin / trusted) of whoever sent the message. */
export function senderRolesOf(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return [];
  const sender = (input as { readonly sender?: unknown }).sender;
  if (!sender || typeof sender !== 'object') return [];
  const role = (sender as { readonly chatRole?: unknown }).chatRole;
  const index = CHAT_ROLE_CHAIN.indexOf(role as typeof CHAT_ROLE_CHAIN[number]);
  return index < 0 ? [] : CHAT_ROLE_CHAIN.slice(index);
}
