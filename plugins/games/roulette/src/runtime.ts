import type { Locale } from 'zhin.js/i18n';
import { definePluginStore, type DeliveryTarget, type Token } from 'zhin.js';
import { resolveRouletteConfig } from './config.js';
import type { RouletteFlow } from './game-flow.js';
import { resolveMutePenalty, type AdapterProjectionContext } from './mute-penalty.js';
import type { RouletteServices } from './session-service.js';

/** Owner-scoped services consumed by discovered commands, middleware and the deadline job. */
export const rouletteServicesStore = definePluginStore<RouletteServices>('zhin.game.roulette.services');
export const rouletteServicesToken = rouletteServicesStore;

/**
 * Whether roulette is enabled for one game conversation (ADR 0050 / 0055). The deadline sweep is
 * not a message, so the dispatch gate does not see it; the sweep asks before announcing a result.
 */
export const rouletteFeatureGateStore = definePluginStore<RouletteFeatureGate>('zhin.game.roulette.feature-gate');
export interface RouletteFeatureGate { isEnabledFor(target: DeliveryTarget): boolean }

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

/** Framework roles (master / trusted / user) of whoever sent the message. */
export function senderRolesOf(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return [];
  const sender = (input as { readonly sender?: unknown }).sender;
  if (!sender || typeof sender !== 'object') return [];
  const roles = (sender as { readonly roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === 'string');
}
