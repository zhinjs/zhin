/**
 * Adapter outage notification helpers.
 *
 * An adapter can notify an operator through another adapter's Endpoint when its
 * own transport goes offline. The target is explicit (`adapter` + `endpoint` +
 * `conversation`) so the notification never guesses an identity and never uses
 * a private bypass around the unified outbound path.
 */
import type { Locale, OutboundHost } from '@zhin.js/plugin-runtime';

export type AdapterNotifyKind = 'private' | 'group' | 'channel';

/** Raw config value under `notify`. */
export interface AdapterNotifyTarget {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind?: AdapterNotifyKind;
  readonly id: string | number;
  /** Thread/channel container, when the target conversation needs a parent. */
  readonly parent?: Readonly<{
    readonly kind: AdapterNotifyKind;
    readonly id: string | number;
  }>;
}

export interface ResolvedAdapterNotifyTarget {
  readonly adapter: string;
  readonly endpoint: string;
  readonly kind: AdapterNotifyKind;
  readonly id: string;
  readonly parent?: Readonly<{ readonly kind: AdapterNotifyKind; readonly id: string }>;
}

export interface AdapterOutageNotifier {
  readonly configured: boolean;
  /** Send a short, user-facing notification. Never throws; returns delivery success. */
  send(text: string, options?: Readonly<{ locale?: Locale }>): Promise<boolean>;
}

/** Validate `notify` config. Invalid values fail adapter setup instead of silently disabling alerts. */
export function resolveAdapterNotifyTarget(value: unknown): ResolvedAdapterNotifyTarget | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('notify must be an object with adapter, endpoint and id');
  }
  const input = value as Record<string, unknown>;
  const adapter = typeof input.adapter === 'string' ? input.adapter.trim() : '';
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  const id = input.id === undefined || input.id === null ? '' : String(input.id).trim();
  if (!adapter || !endpoint || !id) {
    throw new TypeError('notify requires non-empty adapter, endpoint and id');
  }
  const kind = input.kind ?? 'private';
  if (kind !== 'private' && kind !== 'group' && kind !== 'channel') {
    throw new TypeError('notify.kind must be private, group or channel');
  }
  let parent: ResolvedAdapterNotifyTarget['parent'];
  if (input.parent !== undefined && input.parent !== null) {
    if (typeof input.parent !== 'object' || Array.isArray(input.parent)) {
      throw new TypeError('notify.parent must be an object');
    }
    const rawParent = input.parent as Record<string, unknown>;
    const parentKind = rawParent.kind;
    const parentId = rawParent.id === undefined || rawParent.id === null ? '' : String(rawParent.id).trim();
    if ((parentKind !== 'private' && parentKind !== 'group' && parentKind !== 'channel') || !parentId) {
      throw new TypeError('notify.parent requires kind and id');
    }
    parent = Object.freeze({ kind: parentKind, id: parentId });
  }
  return Object.freeze({
    adapter,
    endpoint,
    kind,
    id,
    ...(parent ? { parent } : {}),
  });
}

/**
 * Create a notifier bound to one target. Missing outbound/target degrades to a
 * no-op notifier (`configured: false`), so adapters can stay usable in tests or
 * hosts that do not provide `outboundHostToken`.
 */
export function createAdapterOutageNotifier(
  outbound: OutboundHost | undefined,
  target: ResolvedAdapterNotifyTarget | undefined,
): AdapterOutageNotifier {
  const configured = Boolean(outbound && target);
  return Object.freeze({
    configured,
    async send(text: string, options?: Readonly<{ locale?: Locale }>): Promise<boolean> {
      if (!outbound || !target) return false;
      try {
        await outbound.send({
          adapter: target.adapter,
          endpointKey: target.endpoint,
          conversation: {
            kind: target.kind,
            id: target.id,
            ...(target.parent ? { parent: target.parent } : {}),
          },
          content: text,
          ...(options?.locale ? { locale: options.locale } : {}),
        });
        return true;
      } catch {
        return false;
      }
    },
  });
}
