import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { isOutboundIntentEnvelope } from '@zhin.js/bridge-ipc'
import { OutboundGate } from '@zhin.js/bridge-outbound-gate'
import type { BridgeOutboundNormalizedSend } from '@zhin.js/bridge-outbound-gate'
import { BridgeSupervisor } from '@zhin.js/bridge-supervisor'

import { getBridgeInboundGlueState, runBridgeGlueDispatch, serializeMessageForBridgeDispatch } from './index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const childRoot = path.join(repoRoot, 'packages', 'bridge-nonebot-child')

const childVenvPython =
  process.platform === 'win32'
    ? path.join(childRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(childRoot, '.venv', 'bin', 'python')

function pythonExe(): string {
  if (existsSync(childVenvPython)) {
    return childVenvPython
  }
  if (process.platform === 'win32') {
    const py = spawnSync('py', ['-3', '-c', 'pass'], { stdio: 'ignore' })
    if (py.status === 0) return 'py'
    return 'python'
  }
  return 'python3'
}

function canRunNoneBotChild():
  | { ok: true; runner: { command: string; args: readonly string[]; cwd: string; extraEnv: NodeJS.ProcessEnv } }
  | { ok: false; reason: string } {
  const uvOk = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0
  const imp = uvOk
    ? spawnSync(
        'uv',
        ['run', '--directory', childRoot, 'python', '-c', 'import nonebot; import nonebot.adapters.console'],
        { stdio: 'ignore', cwd: repoRoot, env: process.env },
      )
    : spawnSync(pythonExe(), ['-c', 'import nonebot; import nonebot.adapters.console'], {
        stdio: 'ignore',
        env: { ...process.env, PYTHONPATH: path.join(childRoot, 'src') },
      })
  if (imp.status !== 0) {
    return {
      ok: false,
      reason:
        'Cannot import nonebot2 + nonebot-adapter-console with the resolved runner (try: cd packages/bridge-nonebot-child && uv sync)',
    }
  }
  if (uvOk) {
    return {
      ok: true,
      runner: {
        command: 'uv',
        args: ['run', '--directory', childRoot, 'python', '-m', 'bridge_nonebot_child'],
        cwd: repoRoot,
        extraEnv: {},
      },
    }
  }
  return {
    ok: true,
    runner: {
      command: pythonExe(),
      args: ['-m', 'bridge_nonebot_child'],
      cwd: childRoot,
      extraEnv: { PYTHONPATH: path.join(childRoot, 'src') },
    },
  }
}

const nbProbe = canRunNoneBotChild()

function minimalMessage(overrides: Partial<{ $id: string }> = {}) {
  return {
    $id: overrides.$id ?? 'm-nb-e2e',
    $adapter: 'test' as never,
    $bot: 'b1',
    $content: [{ type: 'text', data: { text: 'plain-from-zhin' } }],
    $sender: { id: 'u1', name: 'Alice' },
    $channel: { id: 'c1', type: 'private' },
    $timestamp: 1,
    $raw: '{}',
    $reply: async () => 'ok',
    $recall: async () => {},
  } as Parameters<typeof serializeMessageForBridgeDispatch>[0]
}

describe('NoneBot2 bridge child e2e (GitHub #411)', () => {
  it.skipIf(!nbProbe.ok)('inbound dispatch → NB tracer → outbound_intent → OutboundGate mock send', async () => {
    const probe = nbProbe as Extract<typeof nbProbe, { ok: true }>
    const sup = new BridgeSupervisor()
    const glueKey = { botId: 'b1', ecosystem: 'test-eco', instanceId: 'nb-e2e' }
    const tok = `tok-${Date.now()}`
    const send = vi.fn(async (_s: BridgeOutboundNormalizedSend) => {})
    const gate = new OutboundGate({
      glueKey,
      policy: { allowedChannelTypes: ['private', 'group', 'channel'] },
      rateLimit: { windowMs: 60_000, maxAttempts: 50 },
      send,
    })

    const pluginModules = JSON.stringify(['bridge_nonebot_child.plugins.tracer'])
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...probe.runner.extraEnv,
      ZHIN_BRIDGE_NB_PLUGIN_MODULES: pluginModules,
      ZHIN_BRIDGE_GLUE_BOT_ID: glueKey.botId,
      ZHIN_BRIDGE_GLUE_ECOSYSTEM: glueKey.ecosystem,
      ZHIN_BRIDGE_GLUE_INSTANCE_ID: glueKey.instanceId,
      ZHIN_BRIDGE_OUTBOUND_CONTEXT: 'test-adapter',
    }

    await sup.start(glueKey, {
      command: probe.runner.command,
      args: probe.runner.args,
      cwd: probe.runner.cwd,
      token: tok,
      env: childEnv,
    })

    const session = sup.getSession(glueKey)!
    const outboundTasks: Promise<unknown>[] = []
    session.on('record', (rec: unknown) => {
      if (isOutboundIntentEnvelope(rec)) {
        outboundTasks.push(gate.submit(rec))
      }
    })

    const message = minimalMessage()
    const r = await runBridgeGlueDispatch({ message, session, k1Ms: 15_000 })
    await Promise.all(outboundTasks)

    expect(r.shortCircuitInbound).toBe(false)
    const st = getBridgeInboundGlueState(message)!
    expect(st.bridgeStatus).toBe('ok')
    expect(send).toHaveBeenCalledTimes(1)
    const arg = send.mock.calls[0]![0]!
    expect(arg.bot).toBe('b1')
    expect(arg.context).toBe('test-adapter')
    expect(arg.channel).toEqual({ type: 'private', id: 'u1' })
    expect(JSON.stringify(arg.content)).toContain('nb-tracer')

    await sup.stop(glueKey)
  })
})
