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

/**
 * Framework roles (master / trusted / user) of whoever sent the message, plus the platform
 * standing (`owner` / `admin` / `member` / `guest`, ADR 0056 §1 `sender.platform`).
 */
export function senderRolesOf(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return [];
  const sender = (input as { readonly sender?: unknown }).sender;
  if (!sender || typeof sender !== 'object') return [];
  const roles = (sender as { readonly roles?: unknown }).roles;
  const framework = Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
  const platform = (sender as { readonly platform?: { readonly standing?: unknown } }).platform;
  return typeof platform?.standing === 'string' ? [...framework, platform.standing] : framework;
}
