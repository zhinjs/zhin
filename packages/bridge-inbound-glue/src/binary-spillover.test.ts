import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { encodeNdjsonRecord } from '@zhin.js/bridge-ipc'
import { BridgeSupervisor } from '@zhin.js/bridge-supervisor'

import { runBridgeGlueDispatch, serializeMessageForBridgeDispatch } from './index.js'

const echoChild = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bridge-ipc/bin/echo-child.mjs',
)

function echoSpec(token: string) {
  return {
    command: process.execPath,
    args: [echoChild],
    token,
  }
}

function messageWithBinaryPayload(byteLength: number) {
  const buf = Buffer.alloc(byteLength, 0xab)
  return {
    $id: 'm-bin',
    $adapter: 'test' as never,
    $bot: 'b1',
    $content: [{ type: 'image', data: buf }],
    $sender: { id: 'u1', name: 'n' },
    $channel: { id: 'c1', type: 'private' },
    $timestamp: 1,
    $raw: '{}',
    $reply: async () => 'ok',
    $recall: async () => {},
  } as Parameters<typeof serializeMessageForBridgeDispatch>[0]
}

describe('M1 binary spillover (#410)', () => {
  const tmpBase = path.join(tmpdir(), `zhin-bridge-spill-test-${process.pid}`)

  it('at maxInlineBytes stays binary_inline (no file_ref)', () => {
    const maxInlineBytes = 100
    const msg = messageWithBinaryPayload(maxInlineBytes)
    const { payload, spillPaths } = serializeMessageForBridgeDispatch(msg, {
      binarySpillover: { maxInlineBytes, tmpDir: tmpBase },
    })
    expect(spillPaths).toHaveLength(0)
    const content = payload.$content as { data: { kind: string } }[]
    expect(content[0].data).toMatchObject({ kind: 'binary_inline', byteLength: maxInlineBytes })
  })

  it('uses ZHIN_BRIDGE_TMP when tmpDir is omitted', () => {
    const prev = process.env.ZHIN_BRIDGE_TMP
    process.env.ZHIN_BRIDGE_TMP = tmpBase
    try {
      const maxInlineBytes = 10
      const msg = messageWithBinaryPayload(50)
      const { spillPaths } = serializeMessageForBridgeDispatch(msg, {
        binarySpillover: { maxInlineBytes },
      })
      expect(spillPaths).toHaveLength(1)
      expect(spillPaths[0].startsWith(tmpBase)).toBe(true)
      unlinkSync(spillPaths[0])
    } finally {
      if (prev === undefined) delete process.env.ZHIN_BRIDGE_TMP
      else process.env.ZHIN_BRIDGE_TMP = prev
    }
  })

  it('one byte over maxInlineBytes becomes file_ref', () => {
    const maxInlineBytes = 100
    const msg = messageWithBinaryPayload(maxInlineBytes + 1)
    const { payload, spillPaths } = serializeMessageForBridgeDispatch(msg, {
      binarySpillover: { maxInlineBytes, tmpDir: tmpBase },
    })
    expect(spillPaths).toHaveLength(1)
    expect(existsSync(spillPaths[0])).toBe(true)
    const content = payload.$content as { data: { kind: string; path?: string } }[]
    expect(content[0].data).toMatchObject({
      kind: 'file_ref',
      byteLength: maxInlineBytes + 1,
      path: spillPaths[0],
    })
    unlinkSync(spillPaths[0])
  })

  it('large payload does not produce giant single-line JSON (file_ref path)', () => {
    const maxInlineBytes = 512
    const big = 80_000
    const msg = messageWithBinaryPayload(big)
    const { payload, spillPaths } = serializeMessageForBridgeDispatch(msg, {
      binarySpillover: { maxInlineBytes, tmpDir: tmpBase },
    })
    const line = encodeNdjsonRecord({
      kind: 'dispatch',
      id: '00000000-0000-4000-8000-000000000001',
      source: 'im',
      queue: null,
      payload,
    })
    expect(line.length).toBeLessThan(20_000)
    expect(line).not.toMatch(/\[[\d,\s]{5000,}\]/)
    unlinkSync(spillPaths[0])
  })

  it('runBridgeGlueDispatch deletes spill files after round-trip', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'spill' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, echoSpec(tok))
    const session = sup.getSession(key)!
    const msg = messageWithBinaryPayload(500)

    await runBridgeGlueDispatch({
      message: msg,
      session,
      k1Ms: 3000,
      binarySpillover: { maxInlineBytes: 100, tmpDir: tmpBase },
    })

    const leftover = readdirSync(tmpBase).filter((f) => f.startsWith('zhin-bridge-spill-'))
    expect(leftover).toEqual([])
    await sup.stop(key)
  })
})
