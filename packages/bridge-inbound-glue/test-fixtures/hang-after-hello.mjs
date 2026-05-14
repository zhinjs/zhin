#!/usr/bin/env node
/**
 * Test child: valid hello, then never answers `dispatch` (parent hits K1).
 */
import { createInterface } from 'node:readline'

const SUPPORTED_VERSION = 1
const token = process.env.ZHIN_BRIDGE_IPC_TOKEN ?? ''

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

let first = true
for await (const line of rl) {
  if (!line.trim()) continue
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    if (first) send({ kind: 'hello_error', code: 'invalid_hello' })
    process.exitCode = 1
    process.exit()
  }
  if (first) {
    first = false
    if (msg?.kind !== 'hello' || typeof msg.protocolVersion !== 'number' || typeof msg.token !== 'string') {
      send({ kind: 'hello_error', code: 'invalid_hello' })
      process.exitCode = 1
      process.exit()
    }
    if (msg.protocolVersion !== SUPPORTED_VERSION) {
      send({ kind: 'hello_error', code: 'version_mismatch' })
      process.exitCode = 1
      process.exit()
    }
    if (msg.token !== token) {
      send({ kind: 'hello_error', code: 'token_mismatch' })
      process.exitCode = 1
      process.exit()
    }
    send({ kind: 'hello_ok', protocolVersion: SUPPORTED_VERSION })
    continue
  }
  if (msg?.kind === 'dispatch' && msg.source === 'im') {
    await new Promise(() => {})
  }
}
