import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  startLocalBackend,
  startSshBackend,
  TerminalStartError,
  type TerminalBackend,
  type TerminalExit,
  type TerminalSize,
} from './backends.js';
import {
  resolveSshCredentials,
  sshCredentialProblem,
  type TerminalConfig,
  type TerminalSshTargetConfig,
} from './config.js';
import { createModuleCache, type TerminalModuleLoaders } from './modules.js';
import { TerminalTicketStore, type IssuedTerminalTicket } from './tickets.js';

/** Authenticated caller. `id` binds tickets and is the revocation key (e.g. `user:<id>`). */
export interface TerminalPrincipal {
  readonly id: string;
  /** Informational (e.g. `user`, `api-token`); authorization is decided by `authorize()` only. */
  readonly kind?: string;
}

export type TerminalAuditAction =
  | 'terminal.session.start'
  | 'terminal.session.end'
  | 'terminal.ticket.issue'
  | 'terminal.denied';

/** Shaped after `console_audit_log` (ADR 0049). Never carries terminal io or credentials. */
export interface TerminalAuditEvent {
  readonly action: TerminalAuditAction;
  /** Principal id, or `anonymous` when unauthenticated. */
  readonly actor: string;
  readonly target: string;
  readonly outcome: 'ok' | 'denied' | 'error';
  readonly ip?: string;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TerminalLogger {
  info?(message: string): void;
  warn?(message: string): void;
  debug?(message: string): void;
}

export type TerminalEndReason =
  | 'disconnect'
  | 'idle-timeout'
  | 'process-exit'
  | 'revoked'
  | 'disabled'
  | 'error';

export interface TerminalTarget {
  readonly id: string;
  readonly kind: 'local' | 'ssh';
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface TerminalSessionInfo {
  readonly sessionId: string;
  readonly principalId: string;
  readonly target: string;
  readonly kind: 'local' | 'ssh';
  readonly startedAt: number;
}

/** Structural subset of a `ws` WebSocket. */
export interface TerminalSocket {
  readonly readyState: number;
  send(data: string | Buffer, options?: { binary?: boolean }, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface TerminalServiceOptions {
  readonly config: TerminalConfig;
  readonly projectRoot: string;
  readonly authorize: (principal: TerminalPrincipal) => boolean | Promise<boolean>;
  readonly audit?: (event: TerminalAuditEvent) => void;
  readonly logger?: TerminalLogger;
  readonly modules?: TerminalModuleLoaders;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  /** Override key file reads (tests). */
  readonly readFile?: (path: string) => Promise<Buffer>;
}

export class TerminalRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'TerminalRequestError';
  }
}

const OPEN = 1;
export const TERMINAL_CLOSE_CODES = Object.freeze({
  normal: 1000,
  startFailed: 1011,
  badRequest: 4400,
  invalidTicket: 4401,
  forbidden: 4403,
  tooManySessions: 4429,
});
const MAX_DIMENSION = 1000;
const MAX_TEXT_FRAME = 4096;
const MAX_INPUT_FRAME = 1 << 20;
const PAUSE_PENDING = 64;
const RESUME_PENDING = 16;

interface Session {
  readonly info: TerminalSessionInfo;
  readonly principal: TerminalPrincipal;
  readonly socket: TerminalSocket;
  readonly ip?: string;
  backend?: TerminalBackend;
  ended: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  end(reason: TerminalEndReason, exit?: TerminalExit): void;
}

/** Terminal tickets, targets and live sessions (ADR 0051). Transport-agnostic. */
export class TerminalService {
  readonly #options: TerminalServiceOptions;
  readonly #tickets: TerminalTicketStore;
  readonly #modules: ReturnType<typeof createModuleCache>;
  readonly #sessions = new Map<string, Session>();
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => number;
  #closed = false;

  constructor(options: TerminalServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#tickets = new TerminalTicketStore({ now: this.#now });
    this.#modules = createModuleCache(options.modules);
    this.#env = options.env ?? process.env;
  }

  get config(): TerminalConfig {
    return this.#options.config;
  }

  /** Throws `TerminalRequestError(403)` unless the principal may use the terminal. */
  async requireAuthorized(principal: TerminalPrincipal | null, ip?: string): Promise<TerminalPrincipal> {
    if (!principal) {
      this.#audit({ action: 'terminal.denied', actor: 'anonymous', target: '', outcome: 'denied', ip, detail: { reason: 'unauthenticated' } });
      throw new TerminalRequestError(401, 'unauthorized', '需要登录');
    }
    let allowed = false;
    try {
      allowed = (await this.#options.authorize(principal)) === true;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      this.#audit({ action: 'terminal.denied', actor: principal.id, target: '', outcome: 'denied', ip, detail: { reason: 'forbidden' } });
      throw new TerminalRequestError(403, 'forbidden', '需要 ops.terminal 权限');
    }
    return principal;
  }

  async listTargets(): Promise<TerminalTarget[]> {
    const pty = await this.#modules.pty();
    const targets: TerminalTarget[] = [{
      id: 'local',
      kind: 'local',
      label: '本机 Shell',
      available: pty.ok,
      ...(pty.ok ? {} : { reason: pty.reason }),
    }];
    if (this.config.ssh.length === 0) return targets;
    const ssh = await this.#modules.ssh();
    for (const target of this.config.ssh) {
      const problem = ssh.ok ? sshCredentialProblem(target, this.#env) : ssh.reason;
      targets.push({
        id: target.name,
        kind: 'ssh',
        label: target.label ?? sshLabel(target),
        available: problem === undefined,
        ...(problem === undefined ? {} : { reason: problem }),
      });
    }
    return targets;
  }

  async issueTicket(principal: TerminalPrincipal, body: unknown, ip?: string): Promise<IssuedTerminalTicket> {
    if (this.#closed) throw new TerminalRequestError(404, 'not-found', '终端未启用');
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const targetId = typeof input.target === 'string' ? input.target : '';
    const size = parseSize(input.cols ?? 80, input.rows ?? 24);
    if (!size) throw new TerminalRequestError(400, 'bad-request', `cols / rows 必须是 1–${MAX_DIMENSION} 的整数`);
    const target = (await this.listTargets()).find((entry) => entry.id === targetId);
    if (!target) throw new TerminalRequestError(404, 'unknown-target', '未知的终端目标');
    if (!target.available) throw new TerminalRequestError(409, 'unavailable', target.reason ?? '终端目标不可用');
    if (this.#sessions.size >= this.config.maxSessions) {
      throw new TerminalRequestError(429, 'too-many-sessions', `终端会话已达上限（${this.config.maxSessions}）`);
    }
    const issued = this.#tickets.issue({ principalId: principal.id, principal, target: target.id, ...size });
    this.#audit({ action: 'terminal.ticket.issue', actor: principal.id, target: target.id, outcome: 'ok', ip, detail: {} });
    return issued;
  }

  /**
   * Handles one accepted WebSocket. `presentedPrincipal` is set when the upgrade
   * also carried a bearer credential; it must then match the ticket's principal.
   */
  async handleConnection(
    socket: TerminalSocket,
    request: Pick<IncomingMessage, 'url' | 'socket'>,
    presentedPrincipal?: TerminalPrincipal | null,
  ): Promise<void> {
    const ip = request.socket?.remoteAddress ?? undefined;
    // Listen before any await: the peer may leave while authorization or startup is pending.
    const connection: { session?: Session; gone: boolean } = { gone: false };
    socket.on('close', () => {
      connection.gone = true;
      connection.session?.end('disconnect');
    });
    socket.on('error', () => {
      connection.gone = true;
      connection.session?.end('error');
    });
    socket.on('message', (data, isBinary) => {
      if (connection.session) this.#onMessage(connection.session, data, isBinary);
    });
    let ticket: string | null = null;
    try {
      ticket = new URL(request.url ?? '/', 'http://localhost').searchParams.get('ticket');
    } catch {
      ticket = null;
    }
    const consumed = this.#tickets.consume(ticket, presentedPrincipal?.id);
    if (!consumed.ok) {
      this.#audit({ action: 'terminal.denied', actor: presentedPrincipal?.id ?? 'anonymous', target: '', outcome: 'denied', ip, detail: { reason: `ticket-${consumed.reason}` } });
      reject(socket, TERMINAL_CLOSE_CODES.invalidTicket, 'invalid-ticket', '终端票据无效或已过期');
      return;
    }
    const { principal, target: targetId, cols, rows } = consumed.grant;
    try {
      // Re-check: the principal may have been revoked since the ticket was issued.
      await this.requireAuthorized(principal, ip);
    } catch {
      reject(socket, TERMINAL_CLOSE_CODES.forbidden, 'forbidden', '需要 ops.terminal 权限');
      return;
    }
    if (this.#closed) {
      reject(socket, TERMINAL_CLOSE_CODES.forbidden, 'disabled', '终端未启用');
      return;
    }
    if (connection.gone) return;
    if (this.#sessions.size >= this.config.maxSessions) {
      this.#audit({ action: 'terminal.denied', actor: principal.id, target: targetId, outcome: 'denied', ip, detail: { reason: 'too-many-sessions' } });
      reject(socket, TERMINAL_CLOSE_CODES.tooManySessions, 'too-many-sessions', `终端会话已达上限（${this.config.maxSessions}）`);
      return;
    }
    const sshTarget = targetId === 'local' ? undefined : this.config.ssh.find((entry) => entry.name === targetId);
    if (targetId !== 'local' && !sshTarget) {
      reject(socket, TERMINAL_CLOSE_CODES.badRequest, 'unknown-target', '未知的终端目标');
      return;
    }
    const kind = sshTarget ? 'ssh' : 'local';
    const info: TerminalSessionInfo = Object.freeze({
      sessionId: randomUUID(),
      principalId: principal.id,
      target: targetId,
      kind,
      startedAt: this.#now(),
    });
    const live = this.#createSession(info, principal, socket, ip);
    connection.session = live;
    this.#sessions.set(info.sessionId, live);

    let pending = 0;
    let paused = false;
    const events = {
      onData: (chunk: Buffer | string) => {
        if (live.ended || socket.readyState !== OPEN) return;
        pending += 1;
        socket.send(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk, { binary: true }, () => {
          pending -= 1;
          if (paused && pending <= RESUME_PENDING) {
            paused = false;
            live.backend?.resume();
          }
        });
        if (!paused && pending >= PAUSE_PENDING) {
          paused = true;
          live.backend?.pause();
        }
      },
      onExit: (exit: TerminalExit) => live.end('process-exit', exit),
    };

    let backend: TerminalBackend;
    try {
      backend = sshTarget
        ? await this.#startSsh(sshTarget, { cols, rows }, events)
        : await this.#startLocal({ cols, rows }, events);
    } catch (error) {
      const code = error instanceof TerminalStartError ? error.code : 'start-failed';
      const message = error instanceof Error ? error.message : String(error);
      this.#sessions.delete(info.sessionId);
      live.ended = true;
      this.#audit({ action: 'terminal.session.start', actor: principal.id, target: targetId, outcome: 'error', ip, detail: { sessionId: info.sessionId, kind, code } });
      this.#options.logger?.warn?.(`terminal start failed | target=${targetId} | code=${code}`);
      reject(socket, TERMINAL_CLOSE_CODES.startFailed, code, message);
      return;
    }
    if (live.ended) {
      // Disconnected (or revoked) while starting.
      backend.kill();
      return;
    }
    live.backend = backend;
    this.#audit({ action: 'terminal.session.start', actor: principal.id, target: targetId, outcome: 'ok', ip, detail: { sessionId: info.sessionId, kind } });
    sendControl(socket, { type: 'ready', sessionId: info.sessionId, target: targetId, kind, cols, rows });
    this.#resetIdle(live);
  }

  /** Ends every session (and pending ticket) of a principal. Returns the number of sessions ended. */
  terminatePrincipal(principalId: string, reason: TerminalEndReason = 'revoked'): number {
    this.#tickets.revokePrincipal(principalId);
    let count = 0;
    for (const session of [...this.#sessions.values()]) {
      if (session.principal.id !== principalId) continue;
      session.end(reason);
      count += 1;
    }
    return count;
  }

  /** Ends all sessions; with `final`, refuses further tickets and connections. */
  closeAll(reason: TerminalEndReason = 'disabled', final = false): void {
    if (final) this.#closed = true;
    this.#tickets.clear();
    for (const session of [...this.#sessions.values()]) session.end(reason);
  }

  sessions(): TerminalSessionInfo[] {
    return [...this.#sessions.values()].map((session) => session.info);
  }

  #createSession(info: TerminalSessionInfo, principal: TerminalPrincipal, socket: TerminalSocket, ip?: string): Session {
    const session: Session = {
      info,
      principal,
      socket,
      ...(ip ? { ip } : {}),
      ended: false,
      end: (reason, exit) => {
        if (session.ended) return;
        session.ended = true;
        if (session.idleTimer) clearTimeout(session.idleTimer);
        this.#sessions.delete(info.sessionId);
        session.backend?.kill();
        if (socket.readyState === OPEN) {
          sendControl(socket, {
            type: 'exit',
            reason,
            code: exit?.code ?? null,
            ...(exit?.signal !== undefined ? { signal: exit.signal } : {}),
          });
          try {
            socket.close(TERMINAL_CLOSE_CODES.normal, reason);
          } catch {
            /* already closing */
          }
        }
        if (!session.backend) return; // never started; start failure is audited separately
        this.#audit({
          action: 'terminal.session.end',
          actor: principal.id,
          target: info.target,
          outcome: 'ok',
          ip,
          detail: {
            sessionId: info.sessionId,
            kind: info.kind,
            durationMs: Math.max(0, this.#now() - info.startedAt),
            exitCode: exit?.code ?? null,
            reason,
          },
        });
      },
    };
    return session;
  }

  #onMessage(session: Session, data: unknown, isBinary: boolean): void {
    if (session.ended || !session.backend) return;
    const buffer = toBuffer(data);
    if (!buffer) return;
    if (isBinary) {
      if (buffer.length > MAX_INPUT_FRAME) {
        sendControl(session.socket, { type: 'error', code: 'frame-too-large', message: '输入帧过大' });
        return;
      }
      this.#resetIdle(session);
      session.backend.write(buffer);
      return;
    }
    if (buffer.length > MAX_TEXT_FRAME) {
      sendControl(session.socket, { type: 'error', code: 'bad-message', message: '控制消息过大' });
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(buffer.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      message = parsed as Record<string, unknown>;
    } catch {
      sendControl(session.socket, { type: 'error', code: 'bad-message', message: '控制消息不是 JSON 对象' });
      return;
    }
    if (message.type === 'resize') {
      const size = parseSize(message.cols, message.rows);
      if (!size) {
        sendControl(session.socket, { type: 'error', code: 'bad-message', message: `cols / rows 必须是 1–${MAX_DIMENSION} 的整数` });
        return;
      }
      session.backend.resize(size);
      return;
    }
    if (message.type === 'ping') {
      // Keep-alive only: does not reset the idle timer (idle means no input).
      sendControl(session.socket, { type: 'pong' });
      return;
    }
    sendControl(session.socket, { type: 'error', code: 'bad-message', message: '未知的控制消息' });
  }

  #resetIdle(session: Session): void {
    const seconds = this.config.idleTimeout;
    if (seconds <= 0) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => session.end('idle-timeout'), seconds * 1000);
    session.idleTimer.unref?.();
  }

  async #startLocal(size: TerminalSize, events: Parameters<typeof startLocalBackend>[3]): Promise<TerminalBackend> {
    const pty = await this.#modules.pty();
    if (!pty.ok) throw new TerminalStartError('unavailable', pty.reason);
    return startLocalBackend(pty.module, { shell: this.config.shell, cwd: this.config.cwd, env: this.#env }, size, events);
  }

  async #startSsh(
    target: TerminalSshTargetConfig,
    size: TerminalSize,
    events: Parameters<typeof startSshBackend>[4],
  ): Promise<TerminalBackend> {
    const ssh = await this.#modules.ssh();
    if (!ssh.ok) throw new TerminalStartError('unavailable', ssh.reason);
    let credentials;
    try {
      credentials = await resolveSshCredentials(target, {
        env: this.#env,
        projectRoot: this.#options.projectRoot,
        ...(this.#options.readFile ? { readFile: this.#options.readFile } : {}),
      });
    } catch (error) {
      throw new TerminalStartError('credentials-unavailable', error instanceof Error ? error.message : String(error));
    }
    return startSshBackend(ssh.module, target, credentials, size, events, {
      onHostKey: (fingerprint) => {
        if (!target.hostFingerprint) {
          this.#options.logger?.info?.(`terminal ssh ${target.name} host key ${fingerprint} (not pinned; set hostFingerprint to enforce)`);
        }
      },
    });
  }

  #audit(event: TerminalAuditEvent): void {
    try {
      const { ip, ...rest } = event;
      this.#options.audit?.(Object.freeze(ip ? { ...rest, ip } : rest));
    } catch (error) {
      this.#options.logger?.warn?.(`terminal audit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function sshLabel(target: TerminalSshTargetConfig): string {
  return `${target.username}@${target.host}${target.port === 22 ? '' : `:${target.port}`}`;
}

function parseSize(cols: unknown, rows: unknown): TerminalSize | undefined {
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
  return valid(cols) && valid(rows) ? { cols, rows } : undefined;
}

function toBuffer(data: unknown): Buffer | undefined {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data) && data.every((item) => Buffer.isBuffer(item))) return Buffer.concat(data as Buffer[]);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return undefined;
}

function sendControl(socket: TerminalSocket, message: Record<string, unknown>): void {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* socket closing */
  }
}

function reject(socket: TerminalSocket, code: number, errorCode: string, message: string): void {
  sendControl(socket, { type: 'error', code: errorCode, message });
  try {
    socket.close(code, errorCode);
  } catch {
    /* already closing */
  }
}
