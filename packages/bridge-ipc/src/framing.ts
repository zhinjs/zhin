import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { BridgeFrameError } from './errors.js'

export function parseNdjsonLine(line: string): unknown {
  const trimmed = line.replace(/\r$/, '')
  if (trimmed.length === 0) {
    throw new BridgeFrameError('empty NDJSON line')
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch (cause) {
    throw new BridgeFrameError('invalid JSON in NDJSON line', { cause, line: trimmed })
  }
}

/** Async line iterator (NDJSON physical lines; JSON payloads may not contain raw newlines). */
export async function* readNdjsonLines(input: Readable): AsyncGenerator<string, void, undefined> {
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      yield line
    }
  } finally {
    rl.close()
  }
}

export function encodeNdjsonRecord(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`
}
