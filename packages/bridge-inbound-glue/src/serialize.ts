import type { Message } from '@zhin.js/core'

import { applyBinarySpilloverDeep, type BinarySpilloverOptions } from './binary-spillover.js'

export type { BinarySpilloverOptions } from './binary-spillover.js'

function jsonSafeClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    if (value === undefined || value === null) return value
    if (typeof value === 'object') {
      return '[non-serializable]'
    }
    return String(value as string | number | boolean)
  }
}

function isBufferLike(value: unknown): value is Uint8Array | Buffer {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
}

/** Deep clone for dispatch trees while keeping binary leaves as Buffer / Uint8Array / ArrayBuffer. */
export function clonePreservingBinary(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (isBufferLike(value)) {
    const u = value instanceof Uint8Array ? value : new Uint8Array(value)
    return Buffer.from(u)
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value))
  }
  if (Array.isArray(value)) {
    return value.map((el) => clonePreservingBinary(el))
  }
  const o = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o)) {
    out[k] = clonePreservingBinary(o[k])
  }
  return out
}

function simplifyContent(message: Message, preserveBinary: boolean): unknown[] {
  const raw = message.$content as unknown[]
  if (!Array.isArray(raw)) return []
  return raw.map((el) => {
    if (el && typeof el === 'object' && 'type' in el) {
      const o = el as { type: unknown; data?: unknown }
      return {
        type: o.type,
        data: o.data !== undefined ? (preserveBinary ? clonePreservingBinary(o.data) : jsonSafeClone(o.data)) : undefined,
      }
    }
    return preserveBinary ? clonePreservingBinary(el) : jsonSafeClone(el)
  })
}

function buildDispatchRecord(message: Message, preserveBinary: boolean): Record<string, unknown> {
  return {
    $id: message.$id,
    $adapter: String(message.$adapter),
    $bot: message.$bot,
    $channel: (preserveBinary ? clonePreservingBinary(message.$channel) : jsonSafeClone(message.$channel)) as Record<
      string,
      unknown
    >,
    $sender: (preserveBinary ? clonePreservingBinary(message.$sender) : jsonSafeClone(message.$sender)) as Record<
      string,
      unknown
    >,
    $content: simplifyContent(message, preserveBinary),
    $timestamp: message.$timestamp,
    $raw: preserveBinary ? clonePreservingBinary(message.$raw) : message.$raw,
  }
}

/**
 * Stable JSON-friendly snapshot of an inbound {@link Message} for `dispatch.payload`
 * (`source: im`).
 */
export function serializeMessageForBridgeDispatch(message: Message): Record<string, unknown>
export function serializeMessageForBridgeDispatch(
  message: Message,
  options: { binarySpillover: BinarySpilloverOptions },
): { payload: Record<string, unknown>; spillPaths: string[] }
export function serializeMessageForBridgeDispatch(
  message: Message,
  options?: { binarySpillover?: BinarySpilloverOptions },
): Record<string, unknown> | { payload: Record<string, unknown>; spillPaths: string[] } {
  if (!options?.binarySpillover) {
    return buildDispatchRecord(message, false)
  }
  const record = buildDispatchRecord(message, true) as Record<string, unknown>
  return applyBinarySpilloverDeep(record, options.binarySpillover)
}
