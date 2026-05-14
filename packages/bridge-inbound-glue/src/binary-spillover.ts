import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Parent-side options for M1 binary spillover before NDJSON `dispatch`. */
export interface BinarySpilloverOptions {
  /**
   * Binary fields with decoded byte length **at or below** this limit are inlined as
   * `{ kind: 'binary_inline', encoding: 'base64', data: string }`. Larger values are written
   * to a temp file and replaced with `{ kind: 'file_ref', ... }`.
   */
  maxInlineBytes: number
  /**
   * Directory for spill files. Defaults to `process.env.ZHIN_BRIDGE_TMP` when set, otherwise
   * {@link os.tmpdir}.
   */
  tmpDir?: string
}

export type BridgeBinaryInlineRef = {
  kind: 'binary_inline'
  encoding: 'base64'
  /** Base64 of raw bytes (no data URL prefix). */
  data: string
  byteLength: number
}

export type BridgeBinaryFileRef = {
  kind: 'file_ref'
  /** Absolute path on the parent host; child should open read-only. */
  path: string
  byteLength: number
}

function resolveTmpDir(opts: BinarySpilloverOptions): string {
  return opts.tmpDir ?? process.env.ZHIN_BRIDGE_TMP ?? os.tmpdir()
}

function isBufferLike(value: unknown): value is Uint8Array | Buffer {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
}

function asUint8Array(value: Uint8Array | Buffer | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

/**
 * Walks `root` (mutates in place) replacing every binary leaf with inline base64 or `file_ref`.
 * Spill files are written before return; {@link spillPaths} lists paths the parent should unlink
 * after the IPC round-trip completes.
 */
export function applyBinarySpilloverDeep(
  root: Record<string, unknown>,
  opts: BinarySpilloverOptions,
): { payload: Record<string, unknown>; spillPaths: string[] } {
  const spillPaths: string[] = []

  function materializeBinary(bytes: Uint8Array): BridgeBinaryInlineRef | BridgeBinaryFileRef {
    const n = bytes.byteLength
    if (n <= opts.maxInlineBytes) {
      return {
        kind: 'binary_inline',
        encoding: 'base64',
        data: Buffer.from(bytes).toString('base64'),
        byteLength: n,
      }
    }
    const dir = resolveTmpDir(opts)
    mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `zhin-bridge-spill-${randomUUID()}.bin`)
    writeFileSync(filePath, Buffer.from(bytes))
    spillPaths.push(filePath)
    return { kind: 'file_ref', path: filePath, byteLength: n }
  }

  function walk(node: unknown): unknown {
    if (node === null || typeof node !== 'object') return node
    if (isBufferLike(node)) {
      const bytes = asUint8Array(node)
      return materializeBinary(bytes)
    }
    if (node instanceof ArrayBuffer) {
      return materializeBinary(new Uint8Array(node))
    }
    if (Array.isArray(node)) {
      const arr = node as unknown[]
      for (let i = 0; i < arr.length; i++) {
        arr[i] = walk(arr[i])
      }
      return arr
    }
    const o = node as Record<string, unknown>
    for (const k of Object.keys(o)) {
      o[k] = walk(o[k]) as never
    }
    return o
  }

  walk(root)
  return { payload: root, spillPaths }
}
