/**
 * ADR 0050 §6 dispatch gate: a Plugin switched off for one adapter / endpoint does not
 * exist there. Indexes are projected once per generation; when an endpoint disables some
 * owners, an equivalent index over the remaining slots is derived and cached per
 * (projection, disabled owner set), so the hot path without overrides stays unchanged.
 */
import { CommandIndex, commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { HandlerIndex, handlerFeatureId, isHandlerIndex } from '@zhin.js/handler';
import { MiddlewareIndex, middlewareFeatureId, isMiddlewareIndex } from '@zhin.js/middleware';
import {
  disabledFeatureOwners, resolveEndpointFeatureKey,
  type FeatureId, type PluginId, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function endpointOf(value: unknown): { id: string; endpointId?: string } | undefined {
  if (!record(value)) return undefined;
  const conversation = record(value.conversation) ? value.conversation : undefined;
  const fromConversation = conversation && record(conversation.endpoint) ? conversation.endpoint.id : undefined;
  const fromEvent = record(value.endpoint) ? value.endpoint.id : undefined;
  const id = typeof fromConversation === 'string' ? fromConversation : typeof fromEvent === 'string' ? fromEvent : undefined;
  if (id !== undefined) return { id, ...(typeof value.endpointId === 'string' ? { endpointId: value.endpointId } : {}) };
  return 'payload' in value ? endpointOf(value.payload) : undefined;
}

/** Resolution key (`<alias>/<endpointId>`) of a message, side event or endpoint event; undefined when unknown. */
export function featureKeyOf(value: unknown, snapshot: RuntimeSnapshot): string | undefined {
  const endpoint = endpointOf(value);
  return endpoint ? resolveEndpointFeatureKey(snapshot, endpoint.id, endpoint.endpointId) : undefined;
}

/** Plugin owners switched off for this input's endpoint in `snapshot`. */
export function disabledOwnersOf(value: unknown, snapshot: RuntimeSnapshot): ReadonlySet<PluginId> {
  const key = featureKeyOf(value, snapshot);
  return key ? disabledFeatureOwners(snapshot, snapshot.tree.keys(), key) : new Set();
}

const derived = new WeakMap<object, Map<string, unknown>>();

function gated<T extends object>(
  index: T,
  snapshot: RuntimeSnapshot,
  feature: FeatureId,
  disabled: ReadonlySet<PluginId>,
  // Slot definitions were validated by the provider; the derived index reuses them as-is.
  build: (slots: never) => T,
): T {
  if (disabled.size === 0) return index;
  const slots = [...snapshot.capabilities.values()].filter(slot => slot.feature === feature);
  if (!slots.some(slot => disabled.has(slot.owner))) return index;
  const key = [...disabled].sort().join('\0');
  let byKey = derived.get(index);
  if (!byKey) { byKey = new Map(); derived.set(index, byKey); }
  const cached = byKey.get(key) as T | undefined;
  if (cached) return cached;
  const value = build(slots.filter(slot => !disabled.has(slot.owner)) as never);
  byKey.set(key, value);
  return value;
}

/** Command index without the commands of owners disabled for `input`'s endpoint (also hides them from menus). */
export function gatedCommandIndex(input: unknown, snapshot: RuntimeSnapshot): CommandIndex | undefined {
  const index = snapshot.projections.get(commandFeatureId);
  if (!isCommandIndex(index)) return undefined;
  return gated(index, snapshot, commandFeatureId, disabledOwnersOf(input, snapshot), slots => {
    // Same menu contract as the Command provider's projection.
    const rootConfig = snapshot.config.get(snapshot.root) as Record<string, unknown> | undefined;
    const rawKeyword = rootConfig?.menuKeyword;
    const menu = rawKeyword === false || rawKeyword === '' ? undefined
      : typeof rawKeyword === 'string' ? { keyword: rawKeyword } : {};
    return new CommandIndex(slots, snapshot, menu);
  });
}

export function gatedMiddlewareIndex(input: unknown, snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const index = snapshot.projections.get(middlewareFeatureId);
  if (!isMiddlewareIndex(index)) return undefined;
  return gated(index, snapshot, middlewareFeatureId, disabledOwnersOf(input, snapshot), slots => new MiddlewareIndex(slots, snapshot));
}

export function gatedHandlerIndex(input: unknown, snapshot: RuntimeSnapshot): HandlerIndex | undefined {
  const index = snapshot.projections.get(handlerFeatureId);
  if (!isHandlerIndex(index)) return undefined;
  return gated(index, snapshot, handlerFeatureId, disabledOwnersOf(input, snapshot), slots => new HandlerIndex(slots, snapshot));
}
