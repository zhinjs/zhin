#!/usr/bin/env node
/**
 * Bridge v1 H1 tracer child: hello (J2/R1), O1 plugin allowlist, `dispatch` → plugins → `outbound_intent` + `dispatch_result`.
 *
 * Config: env `ZHIN_BRIDGE_MIAO_CONFIG` — JSON string
 * `{ "pluginAllowlist": string[], "glueKey": { botId, ecosystem, instanceId }, "context"?: string }`.
 */
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { realpath } from 'node:fs/promises'

const SUPPORTED_VERSION = 1
const token = process.env.ZHIN_BRIDGE_IPC_TOKEN ?? ''
const CONFIG_ENV = 'ZHIN_BRIDGE_MIAO_CONFIG'

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function readConfig() {
  const raw = process.env[CONFIG_ENV]
  if (!raw || typeof raw !== 'string') {
    throw new Error(`${CONFIG_ENV} is required (JSON string)`)
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${CONFIG_ENV} must be valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!cfg || typeof cfg !== 'object') throw new Error(`${CONFIG_ENV}: root must be an object`)
  const allow = cfg.pluginAllowlist
  if (!Array.isArray(allow) || !allow.every((x) => typeof x === 'string' && x.length > 0)) {
    throw new Error(`${CONFIG_ENV}.pluginAllowlist must be a non-empty string[]`)
  }
  const gk = cfg.glueKey
  if (
    !gk ||
    typeof gk !== 'object' ||
    typeof gk.botId !== 'string' ||
    typeof gk.ecosystem !== 'string' ||
    typeof gk.instanceId !== 'string'
  ) {
    throw new Error(`${CONFIG_ENV}.glueKey must be { botId, ecosystem, instanceId }`)
  }
  const context = typeof cfg.context === 'string' && cfg.context.length > 0 ? cfg.context : 'miao'
  return {
    pluginAllowlist: allow,
    glueKey: { botId: gk.botId, ecosystem: gk.ecosystem, instanceId: gk.instanceId },
    context,
  }
}

async function loadPlugins(cfg) {
  const cwd = process.cwd()
  const resolvedPaths = []
  for (const p of cfg.pluginAllowlist) {
    resolvedPaths.push(await realpath(resolve(cwd, p)))
  }
  const instances = []
  for (const abs of resolvedPaths) {
    const mod = await import(pathToFileURL(abs).href)
    const Def = mod?.default
    if (typeof Def !== 'function') {
      throw new Error(`plugin ${abs} must default-export a class`)
    }
    const inst = new Def({ glueKey: cfg.glueKey, context: cfg.context })
    if (typeof inst?.onBridgeDispatch !== 'function') {
      throw new Error(`plugin ${abs} must implement onBridgeDispatch(payload, api)`)
    }
    instances.push(inst)
  }
  return instances
}

async function main() {
  let cfg
  let plugins
  try {
    cfg = readConfig()
    plugins = await loadPlugins(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`miao-tracer-child: config/load error: ${msg}\n`)
    process.exitCode = 1
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

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
      const dispatchId = typeof msg.id === 'string' ? msg.id : ''
      const payload = msg.payload

      const emitOutboundIntent = ({ channel, content }) => {
        const id = randomUUID()
        send({
          kind: 'outbound_intent',
          id,
          source: 'im',
          queue: null,
          correlationId: dispatchId,
          payload: {
            botId: cfg.glueKey.botId,
            ecosystem: cfg.glueKey.ecosystem,
            instanceId: cfg.glueKey.instanceId,
            context: cfg.context,
            channel,
            content,
          },
        })
      }

      try {
        for (const p of plugins) {
          await p.onBridgeDispatch(payload, { dispatchId, emitOutboundIntent })
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        send({
          kind: 'dispatch_result',
          id: dispatchId,
          source: 'im',
          queue: msg.queue ?? null,
          payload: { shortCircuit: false, handled: false, error: err },
        })
        continue
      }

      send({
        kind: 'dispatch_result',
        id: dispatchId,
        source: 'im',
        queue: msg.queue ?? null,
        payload: { shortCircuit: false, handled: true },
      })
    }
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e)
  process.stderr.write(`miao-tracer-child: fatal: ${msg}\n`)
  process.exitCode = 1
  process.exit(1)
})
