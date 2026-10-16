import { Stream } from 'node:stream';

/** Streams are transport-owned handles: record their identity without draining or freezing them. */
export function captureDeliveryValue<T>(value: T): T {
  return capture(value, new WeakMap()) as T;
}

function capture(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value instanceof Stream || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)) return value;
  if (!value || typeof value !== 'object') return structuredClone(value);
  if (seen.has(value)) return seen.get(value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    const copy = Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value);
    seen.set(value, copy);
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(capture(item, seen));
    return Object.freeze(copy);
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(capture(key, seen), capture(item, seen));
    return Object.freeze(copy);
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(capture(item, seen));
    return Object.freeze(copy);
  }
  // Native built-ins retain structuredClone semantics. SDK DTO classes use
  // their enumerable data, just as structuredClone does, but may contain streams.
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    const copy = Object.freeze(structuredClone(value));
    seen.set(value, copy);
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) Object.defineProperty(copy, key, {
    value: capture(item, seen), enumerable: true, writable: true, configurable: true,
  });
  return Object.freeze(copy);
}
