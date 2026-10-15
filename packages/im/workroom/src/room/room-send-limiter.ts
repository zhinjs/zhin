import type { OutboundMessageService } from '@zhin.js/core/runtime';

/**
 * Per-account send rate limiter for Room output (personal QQ accounts can be risk-controlled by the platform).
 *
 * Two forms over ONE shared instance (`createRoomSendLimiter`), both booking into the same per-account map:
 * - `send(request)`: a decorator over `Pick<OutboundMessageService, 'send'>`; once a slot is granted it still
 *   calls the wrapped `send`.
 * - `outboundMiddleware()`: an outbound middleware definition (`{ target: 'outbound', handle(ctx, next) }`);
 *   books a slot, sleeps, then `await next()`. Wrap it as `defineMiddleware(limiter.outboundMiddleware())`
 *   to get the feature brand. `middleware(envelope, next)` is the low-level form underneath it.
 * Either way the normal outbound chain (OutboundRenderer -> outbound middleware -> Endpoint) is never bypassed:
 * the limiter only delays or refuses before `inner.send` / `next()`.
 *
 * C1 MUST make EVERY outbound of a member Endpoint use this same instance (as an outbound middleware, or by
 * wrapping the shared OutboundMessageService), keyed by account. Wrapping only RoomBus's `outbound` under-counts
 * `$reply` and generation output of the same account, so the account-level risk-control protection would only
 * be partial. It is not installed globally by B4.
 *
 * One outbound path must use exactly ONE form (middleware, OR `send` wrapping the OutboundMessageService).
 * Using both on the same path books the same send twice and double-counts it. Share the instance across
 * DIFFERENT paths of the same account, not across two forms of one path.
 */

type DeliveryReceipt = Awaited<ReturnType<OutboundMessageService['send']>>;

const WINDOW_MS = 60_000;
const MAX_KEYS = 1024;

export interface RoomSendLimit {
  readonly maxPerMinute?: number;
  readonly minIntervalMs?: number;
}

export interface RoomSendLimiterOptions {
  /** Wrapped service for the `send` form; without it `send` refuses. Not needed for the `middleware` form. */
  readonly inner?: Pick<OutboundMessageService, 'send'>;
  /** Bot account of an endpoint (e.g. PeerRegistry.selfOf). Falls back to the endpoint id when unknown. */
  readonly accountOf?: (endpointId: string) => string | undefined;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Default 20. */
  readonly maxPerMinute?: number;
  /** Minimum gap between two sends of one account. Default 1000. */
  readonly minIntervalMs?: number;
  /** A send that would have to wait longer is rejected instead. Default 5000. */
  readonly maxWaitMs?: number;
  /** Overrides keyed by account (or `endpoint:<id>` for unresolved accounts). */
  readonly perAccount?: Readonly<Record<string, RoomSendLimit>>;
  readonly logger?: { warn(message: string): void };
}

export interface RateLimitedOutboundOptions extends RoomSendLimiterOptions {
  readonly inner: Pick<OutboundMessageService, 'send'>;
}

/** Structural outbound envelope: only what the limiter reads, so no core middleware type is imported. */
export interface RoomSendEnvelope {
  readonly conversation: { readonly endpoint: { readonly id: string } };
}

export class RoomSendRateLimitedError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'RoomSendRateLimitedError';
  }
}

/** Structural subset of the core outbound middleware context: the envelope lives in `input`. */
export interface RoomOutboundMiddlewareContext {
  readonly input: RoomSendEnvelope;
}

/** Structural outbound middleware definition; `phase` / `order` default in `defineMiddleware`. */
export interface RoomOutboundMiddlewareDefinition {
  readonly target: 'outbound';
  handle(context: RoomOutboundMiddlewareContext, next: () => Promise<void>): Promise<void>;
}

export interface RoomSendLimiter {
  send(request: Parameters<OutboundMessageService['send']>[0]): Promise<DeliveryReceipt>;
  /**
   * Low-level: takes the ENVELOPE, not the core middleware context. Passing the context makes `reserve` fail
   * closed on every send. Use `outboundMiddleware()` in plugins. Adaptation by hand:
   * `handle: (ctx, next) => limiter.middleware(ctx.input, next)`.
   * Throws RoomSendRateLimitedError when refused.
   */
  middleware(envelope: RoomSendEnvelope, next: () => Promise<void>): Promise<void>;
  /**
   * Outbound middleware definition for plugins: `defineMiddleware(limiter.outboundMiddleware())`.
   * Do not combine with `send` on the same outbound path (double counting).
   */
  outboundMiddleware(): RoomOutboundMiddlewareDefinition;
}

interface Booking {
  /** Reserved send times, ascending; only the last `maxPerMinute` are kept. */
  slots: number[];
  last: number;
}

function positive(name: string, value: number | undefined, fallback: number, allowZero = false): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0 : 1)) {
    throw new RangeError(`Room send limiter option ${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer, got ${String(resolved)}`);
  }
  return resolved;
}

const rejected = (code: string, message: string, retryable: boolean): DeliveryReceipt =>
  Object.freeze({ status: 'rejected' as const, failure: Object.freeze({ code, message, retryable }) });

export function createRoomSendLimiter(options: RoomSendLimiterOptions): RoomSendLimiter {
  const { inner, logger } = options;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const maxPerMinute = positive('maxPerMinute', options.maxPerMinute, 20);
  const minIntervalMs = positive('minIntervalMs', options.minIntervalMs, 1000, true);
  const maxWaitMs = positive('maxWaitMs', options.maxWaitMs, 5000, true);
  const overrides = new Map<string, { maxPerMinute: number; minIntervalMs: number }>();
  for (const [key, limit] of Object.entries(options.perAccount ?? {})) {
    overrides.set(key, {
      maxPerMinute: positive(`perAccount.${key}.maxPerMinute`, limit.maxPerMinute, maxPerMinute),
      minIntervalMs: positive(`perAccount.${key}.minIntervalMs`, limit.minIntervalMs, minIntervalMs, true),
    });
  }
  const bookings = new Map<string, Booking>();

  const sweep = (at: number): void => {
    for (const [key, booking] of bookings) {
      if (booking.last + WINDOW_MS <= at) bookings.delete(key);
    }
  };

  /** Synchronous so that arrival order equals booking order. Returns the wait, or a rejection receipt. */
  const reserve = (request: RoomSendEnvelope): number | DeliveryReceipt => {
    try {
      const endpointId = request.conversation.endpoint.id;
      if (typeof endpointId !== 'string' || endpointId === '') throw new TypeError('request has no endpoint id');
      const key = options.accountOf?.(endpointId) || `endpoint:${endpointId}`;
      const limit = overrides.get(key) ?? { maxPerMinute, minIntervalMs };
      const at = now();
      if (!Number.isFinite(at)) throw new TypeError('clock returned a non-finite value');

      let booking = bookings.get(key);
      if (booking && booking.last + WINDOW_MS <= at) {
        bookings.delete(key);
        booking = undefined;
      }
      if (!booking) {
        if (bookings.size >= MAX_KEYS) sweep(at);
        if (bookings.size >= MAX_KEYS) {
          return rejected('room_send_guard_error', `too many tracked send accounts (${MAX_KEYS})`, true);
        }
      }
      const slots = booking?.slots ?? [];
      let slot = Math.max(at, booking ? booking.last + limit.minIntervalMs : at);
      if (slots.length >= limit.maxPerMinute) {
        slot = Math.max(slot, slots[slots.length - limit.maxPerMinute] + WINDOW_MS);
      }
      const wait = slot - at;
      if (wait > maxWaitMs) {
        return rejected('room_send_rate_limited', `account ${key} send rate limit reached; retry in ${wait} ms`, true);
      }
      // Booked before sending: platform risk control counts attempts, so failures count too.
      slots.push(slot);
      while (slots.length > limit.maxPerMinute) slots.shift();
      bookings.set(key, { slots, last: slot });
      return wait;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn(`room send limiter failed closed: ${message}`);
      return rejected('room_send_guard_error', message, false);
    }
  };

  const middleware = async (envelope: RoomSendEnvelope, next: () => Promise<void>): Promise<void> => {
    const wait = reserve(envelope);
    if (typeof wait !== 'number') {
      logger?.warn(`room send refused: ${wait.failure?.code ?? wait.status}`);
      throw new RoomSendRateLimitedError(
        wait.failure?.code ?? 'room_send_guard_error', wait.failure?.message ?? 'send refused', wait.failure?.retryable ?? false);
    }
    if (wait > 0) await sleep(wait);
    await next();
  };

  return Object.freeze({
    async send(request: Parameters<OutboundMessageService['send']>[0]): Promise<DeliveryReceipt> {
      if (!inner) return rejected('room_send_guard_error', 'send limiter has no inner service', false);
      const wait = reserve(request);
      if (typeof wait !== 'number') {
        logger?.warn(`room send refused: ${wait.failure?.code ?? wait.status}`);
        return wait;
      }
      if (wait > 0) await sleep(wait);
      return inner.send(request);
    },
    middleware,
    outboundMiddleware(): RoomOutboundMiddlewareDefinition {
      return Object.freeze({
        target: 'outbound' as const,
        handle: (context: RoomOutboundMiddlewareContext, next: () => Promise<void>) => middleware(context.input, next),
      });
    },
  });
}

/** Tests / standalone use only. Production (C1) uses the shared `createRoomSendLimiter` instance. */
export function createRateLimitedOutbound(options: RateLimitedOutboundOptions): Pick<OutboundMessageService, 'send'> {
  const limiter = createRoomSendLimiter(options);
  return Object.freeze({ send: (request: Parameters<OutboundMessageService['send']>[0]) => limiter.send(request) });
}
