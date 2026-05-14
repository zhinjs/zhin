/**
 * N3: one glue child per Bot identity + ecosystem + named instance (no cross-wiring).
 */
export interface BridgeGlueInstanceKey {
  botId: string
  ecosystem: string
  instanceId: string
}

/** Stable map key for {@link BridgeGlueInstanceKey}. */
export function formatGlueInstanceKey(key: BridgeGlueInstanceKey): string {
  return `${key.botId}\x1f${key.ecosystem}\x1f${key.instanceId}`
}

export type BridgeGlueLifecycleState = 'idle' | 'starting' | 'running' | 'disabled'

export type BridgeGlueDisabledReason =
  | 'handshake_rejected'
  | 'handshake_protocol'
  | 'frame_error'
  | 'eof'
  | 'spawn_failed'
  | 'fatal_ipc'
  | 'unknown'

export interface BridgeGlueLastError {
  message: string
  name: string
  /** Wire or library failure code when present */
  code?: string
}

export interface BridgeGlueHealth {
  key: BridgeGlueInstanceKey
  state: BridgeGlueLifecycleState
  /** Handshake complete and IPC session usable */
  alive: boolean
  /** When state is `disabled`, why the glue module was turned off */
  disabledReason: BridgeGlueDisabledReason | null
  lastError: BridgeGlueLastError | null
}

/** Resolved start spec (secrets must be resolved by caller — env or config interpolation). */
export interface BridgeGlueStartSpec {
  command: string
  args: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Shared secret for J2 / child env */
  token: string
  /** Child env key for token (echo child default). */
  tokenEnvKey?: string
  protocolVersion?: number
  /** Tests / miswire: J2 token only, child env still uses {@link token}. */
  helloToken?: string
  /** Optional working temp dir forwarded into child env */
  tmpDir?: string
  tmpDirEnvKey?: string
}

export type BridgeSupervisorLogEvent =
  | {
      event: 'bridge_glue.disabled'
      key: BridgeGlueInstanceKey
      reason: BridgeGlueDisabledReason
      error: BridgeGlueLastError
      policy: 'S1_no_auto_retry'
    }
  | {
      event: 'bridge_glue.start_skipped'
      key: BridgeGlueInstanceKey
      cause: 'already_running' | 's1_disabled_until_restart'
    }
  | {
      event: 'bridge_glue.started'
      key: BridgeGlueInstanceKey
    }
  | {
      event: 'bridge_glue.stopped'
      key: BridgeGlueInstanceKey
    }

export type BridgeSupervisorLogger = (entry: BridgeSupervisorLogEvent) => void
