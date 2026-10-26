/**
 * IM authoring defaults; the underlying Feature remains transport independent.
 * @module zhin.js/middleware
 */
export type {
  MiddlewareContinuation,
  MiddlewareDefinitionBase,
  MiddlewareNext,
  MiddlewarePhase,
  MiddlewareTarget,
  OutboundMiddlewareNext,
} from '@zhin.js/middleware';
import {
  defineMiddleware as defineFeatureMiddleware,
  type MiddlewareAuthoringDefinition,
  type MiddlewareContext as FeatureMiddlewareContext,
  type MiddlewareDefinition as FeatureMiddlewareDefinition,
} from '@zhin.js/middleware';
import type { Message, OutboundEnvelope } from '../plugin-runtime/im/contracts.js';

export type MiddlewareContext<
  TInput = Message,
  TConfig = unknown,
  TAdapter extends string | undefined = undefined,
> = FeatureMiddlewareContext<TInput, TConfig, TAdapter>;

export type MiddlewareDefinition<
  TInput = Message,
  TConfig = unknown,
  TAdapter extends string | undefined = string | undefined,
> = FeatureMiddlewareDefinition<TInput, TConfig, TAdapter>;

/** Incoming IM middleware receives Message; outbound middleware receives its envelope. */
export function defineMiddleware<TInput = OutboundEnvelope, TConfig = unknown>(
  definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target: 'outbound' }>,
): Readonly<Extract<FeatureMiddlewareDefinition<TInput, TConfig>, { readonly target: 'outbound' }>>;
export function defineMiddleware<TInput = Message, TConfig = unknown>(
  definition: Extract<MiddlewareAuthoringDefinition<TInput, TConfig>, { readonly target?: 'inbound' }>,
): Readonly<Extract<FeatureMiddlewareDefinition<TInput, TConfig>, { readonly target: 'inbound' }>>;
export function defineMiddleware<TInput, TConfig>(
  definition: MiddlewareAuthoringDefinition<TInput, TConfig>,
): Readonly<FeatureMiddlewareDefinition<TInput, TConfig>> {
  // Both overloads deliberately delegate the same validation and feature brand.
  const define = defineFeatureMiddleware as (
    value: MiddlewareAuthoringDefinition<TInput, TConfig>,
  ) => Readonly<FeatureMiddlewareDefinition<TInput, TConfig>>;
  return define(definition);
}

export { outboundPresentationToken } from '../plugin-runtime/im/outbound-presentation.js';
export type {
  OutboundPresentation, OutboundPresentationContext, OutboundPresentationMode,
  OutboundPresentationPreferences,
} from '../plugin-runtime/im/outbound-presentation.js';
