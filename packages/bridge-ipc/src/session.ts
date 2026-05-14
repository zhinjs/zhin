import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { BridgeEofError, BridgeFrameError, BridgeHandshakeError } from './errors.js'
import { encodeNdjsonRecord, parseNdjsonLine, readNdjsonLines } from './framing.js'
import {
  BRIDGE_PROTOCOL_VERSION,
  isDispatchResult,
  isHelloError,
  isHelloOk,
  type BridgeDispatchEnvelope,
  type BridgeHelloParent,
} from './types.js'

export interface BridgeParentHandshakeOptions {
  /** Shared secret injected into child env (reference child) and used in hello unless {@link helloToken} is set. */
  token: string
  /** If set, only the J2 hello frame uses this value; child env still receives {@link token}. For tests / miswire simulation. */
  helloToken?: string
  /** Defaults to {@link BRIDGE_PROTOCOL_VERSION}. */
  protocolVersion?: number
}

export interface BridgeParentSpawnOptions extends BridgeParentHandshakeOptions {
  command: string
  args: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Child env key for injected token (reference echo child). Default `ZHIN_BRIDGE_IPC_TOKEN`. */
  tokenEnvKey?: string
}

export type BridgeParentEvents = {
  record: [unknown]
  fatal: [Error]
  end: []
}

export declare interface BridgeParentSession {
  on<U extends keyof BridgeParentEvents>(
    event: U,
    listener: (...args: BridgeParentEvents[U]) => void,
  ): this
  emit<U extends keyof BridgeParentEvents>(event: U, ...args: BridgeParentEvents[U]): boolean
}

/**
 * Parent-side stdio NDJSON session: hello (J2/R1), then framed business records.
 */
export class BridgeParentSession extends EventEmitter {
  private consumeTask: Promise<void> | null = null
  private firstLineWait: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null
  private handshakeFinished = false
  private eof = false
  private fatalError: Error | null = null
  private readonly preHandshakeBacklog: unknown[] = []
  private readonly pendingDispatch = new Map<
    string,
    { resolve: (p: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()

  private constructor(
    private readonly childStdin: Writable,
    private readonly childStdout: Readable,
    private readonly child: ChildProcess | null,
    private readonly handshakeOpts: BridgeParentHandshakeOptions,
  ) {
    super()
  }

  /** Attach to existing stdio (tests). You must call {@link startHandshake} (or use {@link spawn}). */
  static attach(
    childStdin: Writable,
    childStdout: Readable,
    handshakeOpts: BridgeParentHandshakeOptions,
  ): BridgeParentSession {
    return new BridgeParentSession(childStdin, childStdout, null, handshakeOpts)
  }

  static async spawn(options: BridgeParentSpawnOptions): Promise<BridgeParentSession> {
    const envKey = options.tokenEnvKey ?? 'ZHIN_BRIDGE_IPC_TOKEN'
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, [envKey]: options.token },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const { stdin, stdout } = child
    if (!stdin || !stdout) {
      throw new Error('child stdio pipes are unavailable')
    }
    const session = new BridgeParentSession(stdin, stdout, child, {
      token: options.token,
      helloToken: options.helloToken,
      protocolVersion: options.protocolVersion,
    })
    try {
      await session.startHandshake()
      return session
    } catch (e) {
      await session.close().catch(() => {})
      throw e
    }
  }

  /** Begin read loop + hello when using {@link attach}. */
  async startHandshake(): Promise<void> {
    const firstPromise = new Promise<unknown>((resolve, reject) => {
      this.firstLineWait = { resolve, reject }
    })
    this.startReadLoop()
    const pv = this.handshakeOpts.protocolVersion ?? BRIDGE_PROTOCOL_VERSION
    const hello: BridgeHelloParent = {
      kind: 'hello',
      protocolVersion: pv,
      token: this.handshakeOpts.helloToken ?? this.handshakeOpts.token,
    }
    this.writeRaw(encodeNdjsonRecord(hello))
    const first = await firstPromise
    if (isHelloError(first)) {
      throw new BridgeHandshakeError(`hello failed: ${first.code}`, first.code)
    }
    if (!isHelloOk(first)) {
      throw new BridgeHandshakeError('first child frame was not hello_ok', 'unexpected_record')
    }
    if (first.protocolVersion !== pv) {
      throw new BridgeHandshakeError(
        `protocolVersion mismatch: child ${first.protocolVersion} vs parent ${pv}`,
        'protocol_error',
      )
    }
    this.handshakeFinished = true
    for (const rec of this.preHandshakeBacklog.splice(0)) {
      this.handleBusinessRecord(rec)
    }
  }

  get ended(): boolean {
    return this.eof || this.fatalError !== null
  }

  sendDispatch(payload: unknown, id: string = randomUUID()): string {
    if (!this.handshakeFinished) {
      throw new BridgeHandshakeError('handshake not complete', 'protocol_error')
    }
    if (this.ended) {
      throw new BridgeEofError('cannot send dispatch: IPC closed')
    }
    const env: BridgeDispatchEnvelope = {
      kind: 'dispatch',
      id,
      source: 'im',
      queue: null,
      payload,
    }
    this.writeRaw(encodeNdjsonRecord(env))
    return id
  }

  waitForDispatchResult(id: string, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pendingDispatch.get(id)
        if (p) {
          clearTimeout(p.timer)
          this.pendingDispatch.delete(id)
        }
        reject(new BridgeFrameError(`dispatch_result timeout for id ${id}`))
      }, timeoutMs)
      this.pendingDispatch.set(id, { resolve, reject, timer })
    })
  }

  async close(): Promise<void> {
    this.childStdin.end()
    this.child?.kill('SIGTERM')
    if (this.consumeTask) {
      await this.consumeTask.catch(() => {})
    }
  }

  private startReadLoop(): void {
    if (this.consumeTask) {
      return
    }
    this.consumeTask = (async () => {
      try {
        for await (const line of readNdjsonLines(this.childStdout)) {
          if (!line.trim()) continue
          let rec: unknown
          try {
            rec = parseNdjsonLine(line)
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            this.rejectFirstLineIfWaiting(err)
            throw err
          }
          if (this.firstLineWait) {
            const w = this.firstLineWait
            this.firstLineWait = null
            w.resolve(rec)
            continue
          }
          if (!this.handshakeFinished) {
            this.preHandshakeBacklog.push(rec)
            continue
          }
          this.handleBusinessRecord(rec)
        }
        this.rejectFirstLineIfWaiting(new BridgeEofError('EOF before hello response'))
        this.markEof()
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        this.setFatal(err)
      }
    })()
  }

  private rejectFirstLineIfWaiting(err: Error): void {
    if (this.firstLineWait) {
      const w = this.firstLineWait
      this.firstLineWait = null
      w.reject(err)
    }
  }

  private handleBusinessRecord(rec: unknown): void {
    if (isDispatchResult(rec)) {
      const pending = this.pendingDispatch.get(rec.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingDispatch.delete(rec.id)
        pending.resolve(rec.payload)
      }
    }
    this.emit('record', rec)
  }

  private markEof(): void {
    if (this.eof) return
    this.eof = true
    for (const [, p] of this.pendingDispatch) {
      clearTimeout(p.timer)
      p.reject(new BridgeEofError('stream ended before dispatch_result'))
    }
    this.pendingDispatch.clear()
    this.emit('end')
  }

  private setFatal(err: Error): void {
    if (this.fatalError) return
    this.fatalError = err
    this.rejectFirstLineIfWaiting(err)
    for (const [, p] of this.pendingDispatch) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pendingDispatch.clear()
    this.emit('fatal', err)
  }

  private writeRaw(s: string): void {
    if (this.ended) {
      throw new BridgeEofError('cannot write: IPC closed')
    }
    this.childStdin.write(s)
  }
}
