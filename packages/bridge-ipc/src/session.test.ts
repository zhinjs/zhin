import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BridgeEofError, BridgeHandshakeError } from './errors.js'
import { BridgeParentSession } from './session.js'

const echoChild = join(dirname(fileURLToPath(import.meta.url)), '../bin/echo-child.mjs')

function spawnEchoSession(token: string, protocolVersion?: number) {
  return BridgeParentSession.spawn({
    command: process.execPath,
    args: [echoChild],
    token,
    protocolVersion,
  })
}

describe('BridgeParentSession + echo child', () => {
  it('hello OK and dispatch echo roundtrip', async () => {
    const token = `test-token-${Date.now()}`
    const session = await spawnEchoSession(token)
    try {
      const id = 'msg-1'
      const p = session.waitForDispatchResult(id)
      session.sendDispatch({ hello: 'world' }, id)
      await expect(p).resolves.toEqual({ hello: 'world' })
    } finally {
      await session.close()
    }
  })

  it('token mismatch yields BridgeHandshakeError', async () => {
    const token = `good-${Date.now()}`
    await expect(
      BridgeParentSession.spawn({
        command: process.execPath,
        args: [echoChild],
        token,
        helloToken: 'wrong-on-wire',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      return e instanceof BridgeHandshakeError && e.code === 'token_mismatch'
    })
  })

  it('protocolVersion mismatch yields BridgeHandshakeError', async () => {
    const token = `pv-${Date.now()}`
    await expect(spawnEchoSession(token, 999)).rejects.toSatisfy((e: unknown) => {
      return e instanceof BridgeHandshakeError && e.code === 'version_mismatch'
    })
  })

  it('EOF before hello yields BridgeEofError', async () => {
    await expect(
      BridgeParentSession.spawn({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        token: 'x',
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof BridgeEofError)
  })
})
