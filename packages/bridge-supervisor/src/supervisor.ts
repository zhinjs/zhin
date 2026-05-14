import { BridgeParentSession } from '@zhin.js/bridge-ipc'

import { classifyGlueFailure } from './classify-error.js'
import type {
  BridgeGlueHealth,
  BridgeGlueInstanceKey,
  BridgeGlueStartSpec,
  BridgeSupervisorLogger,
} from './types.js'
import { formatGlueInstanceKey } from './types.js'

export interface BridgeStartResult {
  ok: boolean
  health: BridgeGlueHealth
  /** When `start` is a no-op because S1 left the instance disabled */
  skipped?: 's1_disabled_until_restart' | 'already_running'
}

interface InternalEntry {
  key: BridgeGlueInstanceKey
  state: BridgeGlueHealth['state']
  session: BridgeParentSession | null
  disabledReason: BridgeGlueHealth['disabledReason']
  lastError: BridgeGlueHealth['lastError']
  /** User-initiated stop: do not treat stream end as glue failure */
  stopping: boolean
}

function emptyEntry(key: BridgeGlueInstanceKey): InternalEntry {
  return {
    key,
    state: 'idle',
    session: null,
    disabledReason: null,
    lastError: null,
    stopping: false,
  }
}

function toHealth(e: InternalEntry): BridgeGlueHealth {
  const alive = e.state === 'running' && e.session !== null && !e.session.ended
  return {
    key: e.key,
    state: e.state,
    alive,
    disabledReason: e.disabledReason,
    lastError: e.lastError,
  }
}

const noopLog: BridgeSupervisorLogger = () => {}

/**
 * Per {@link BridgeGlueInstanceKey} glue child supervisor: N3 isolation, S1 (no background
 * retry after disable — use {@link restart}), handshake failure disables only that instance.
 */
export class BridgeSupervisor {
  private readonly entries = new Map<string, InternalEntry>()
  private readonly inFlight = new Map<string, Promise<BridgeStartResult>>()
  private readonly log: BridgeSupervisorLogger

  constructor(options?: { log?: BridgeSupervisorLogger }) {
    this.log = options?.log ?? noopLog
  }

  getHealth(key: BridgeGlueInstanceKey): BridgeGlueHealth {
    const id = formatGlueInstanceKey(key)
    const e = this.entries.get(id) ?? emptyEntry(key)
    return toHealth({ ...e, key })
  }

  isGlueEnabled(key: BridgeGlueInstanceKey): boolean {
    const h = this.getHealth(key)
    return h.state !== 'disabled'
  }

  /**
   * Active IPC session for a running instance, if handshake completed and stdio is still open.
   * Used by inbound glue to send `dispatch` / wait for `dispatch_result` (see `@zhin.js/bridge-inbound-glue`).
   */
  getSession(key: BridgeGlueInstanceKey): BridgeParentSession | undefined {
    const id = formatGlueInstanceKey(key)
    const entry = this.entries.get(id)
    if (!entry || entry.state !== 'running' || !entry.session || entry.session.ended) {
      return undefined
    }
    return entry.session
  }

  /**
   * Start or ensure running. Does **not** retry if the instance is **disabled** (S1) —
   * use {@link restart} after fixing config or child.
   */
  start(key: BridgeGlueInstanceKey, spec: BridgeGlueStartSpec): Promise<BridgeStartResult> {
    const id = formatGlueInstanceKey(key)
    const existing = this.inFlight.get(id)
    if (existing) {
      return existing
    }
    const p = this.runStart(id, key, spec).finally(() => {
      if (this.inFlight.get(id) === p) {
        this.inFlight.delete(id)
      }
    })
    this.inFlight.set(id, p)
    return p
  }

  /** Clear disabled flag and attempt start (explicit operator / config reload). */
  async restart(key: BridgeGlueInstanceKey, spec: BridgeGlueStartSpec): Promise<BridgeStartResult> {
    const id = formatGlueInstanceKey(key)
    const entry = this.getOrCreate(id, key)
    await this.closeSessionIfAny(entry, id)
    entry.state = 'idle'
    entry.disabledReason = null
    entry.lastError = null
    return this.start(key, spec)
  }

  async stop(key: BridgeGlueInstanceKey): Promise<void> {
    const id = formatGlueInstanceKey(key)
    const entry = this.entries.get(id)
    if (!entry) return
    entry.stopping = true
    try {
      await this.closeSessionIfAny(entry, id)
      entry.state = 'idle'
      entry.disabledReason = null
      entry.lastError = null
    } finally {
      entry.stopping = false
    }
    this.log({ event: 'bridge_glue.stopped', key })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => {
      const parts = id.split('\x1f')
      if (parts.length !== 3) return Promise.resolve()
      const key: BridgeGlueInstanceKey = { botId: parts[0]!, ecosystem: parts[1]!, instanceId: parts[2]! }
      return this.stop(key)
    }))
  }

  private getOrCreate(id: string, key: BridgeGlueInstanceKey): InternalEntry {
    let e = this.entries.get(id)
    if (!e) {
      e = emptyEntry(key)
      this.entries.set(id, e)
    }
    return e
  }

  private async runStart(
    id: string,
    key: BridgeGlueInstanceKey,
    spec: BridgeGlueStartSpec,
  ): Promise<BridgeStartResult> {
    const entry = this.getOrCreate(id, key)

    if (entry.state === 'disabled') {
      this.log({ event: 'bridge_glue.start_skipped', key, cause: 's1_disabled_until_restart' })
      return { ok: false, health: toHealth(entry), skipped: 's1_disabled_until_restart' }
    }

    if (entry.state === 'running' && entry.session && !entry.session.ended) {
      this.log({ event: 'bridge_glue.start_skipped', key, cause: 'already_running' })
      return { ok: true, health: toHealth(entry), skipped: 'already_running' }
    }

    await this.closeSessionIfAny(entry, id)

    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...spec.env }
    if (spec.tmpDir) {
      const k = spec.tmpDirEnvKey ?? 'TMPDIR'
      childEnv[k] = spec.tmpDir
    }

    entry.state = 'starting'
    entry.disabledReason = null
    entry.lastError = null

    try {
      const session = await BridgeParentSession.spawn({
        command: spec.command,
        args: spec.args,
        cwd: spec.cwd,
        env: childEnv,
        token: spec.token,
        helloToken: spec.helloToken,
        protocolVersion: spec.protocolVersion,
        tokenEnvKey: spec.tokenEnvKey,
      })
      entry.session = session
      entry.state = 'running'
      this.attachRuntimeWatchers(id, entry, session)
      this.log({ event: 'bridge_glue.started', key })
      return { ok: true, health: toHealth(entry) }
    } catch (err) {
      const { reason, last } = classifyGlueFailure(err)
      entry.session = null
      entry.state = 'disabled'
      entry.disabledReason = reason
      entry.lastError = last
      this.log({
        event: 'bridge_glue.disabled',
        key,
        reason,
        error: last,
        policy: 'S1_no_auto_retry',
      })
      return { ok: false, health: toHealth(entry) }
    }
  }

  private attachRuntimeWatchers(id: string, entry: InternalEntry, session: BridgeParentSession): void {
    const onFatal = (err: Error) => {
      if (entry.stopping) return
      if (entry.state !== 'running') return
      const { reason, last } = classifyGlueFailure(err)
      entry.session = null
      entry.state = 'disabled'
      entry.disabledReason = reason
      entry.lastError = last
      this.log({
        event: 'bridge_glue.disabled',
        key: entry.key,
        reason,
        error: last,
        policy: 'S1_no_auto_retry',
      })
    }
    const onEnd = () => {
      if (entry.stopping) {
        entry.session = null
        entry.state = 'idle'
        return
      }
      if (entry.state !== 'running') return
      entry.session = null
      entry.state = 'disabled'
      entry.disabledReason = 'eof'
      entry.lastError = { message: 'IPC stream ended unexpectedly', name: 'BridgeGlueSupervisor' }
      this.log({
        event: 'bridge_glue.disabled',
        key: entry.key,
        reason: 'eof',
        error: entry.lastError,
        policy: 'S1_no_auto_retry',
      })
    }
    session.once('fatal', onFatal)
    session.once('end', onEnd)
  }

  private async closeSessionIfAny(entry: InternalEntry, _id: string): Promise<void> {
    if (!entry.session) return
    entry.stopping = true
    try {
      await entry.session.close()
    } finally {
      entry.session = null
      entry.stopping = false
    }
  }
}
