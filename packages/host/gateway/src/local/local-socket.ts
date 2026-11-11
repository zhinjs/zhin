/**
 * Local control socket of the gateway (ADR 0054 §6): `.zhin/gateway.sock` with mode 0600 in a
 * directory only the current user can write (a named pipe on Windows). A second gateway on the
 * same project is refused while the first answers; a socket left by a dead gateway is removed.
 * Whoever can connect is the local owner (principal `'local'`).
 */
import { lstat, mkdir, chmod, rm, stat } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { GatewayPackageEvent } from '@zhin.js/console-protocol';
import { isNamedPipe } from './paths.js';
import {
  LineDecoder,
  type LocalGatewayError,
  type LocalGatewayRequest,
  type LocalGatewayServerLine,
} from './protocol.js';

export type LocalSocketErrorCode = 'in_use' | 'not_owner' | 'insecure_dir' | 'not_socket' | 'insecure_socket';

export class LocalSocketError extends Error {
  constructor(readonly code: LocalSocketErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalSocketError';
  }
}

export interface LocalSocketSecurityOptions {
  /** Current user id; `undefined` skips owner checks (Windows). Default `process.getuid()`. */
  readonly uid?: () => number | undefined;
  /** Connect probe timeout for an existing socket. Default 1 s. */
  readonly probeTimeoutMs?: number;
}

export type LocalRequestResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; error: LocalGatewayError }>;

/** Answers one request; `emit` streams events for it before the answer. */
export type LocalRequestHandler = (request: LocalGatewayRequest, emit: (event: GatewayPackageEvent) => void) => Promise<LocalRequestResult>;

export interface LocalControlServerOptions extends LocalSocketSecurityOptions {
  readonly path: string;
  /** Requests before {@link LocalControlServer.setHandler} get `unavailable`. */
  readonly handler?: LocalRequestHandler;
  readonly maxConnections?: number;
}

const DEFAULT_MAX_CONNECTIONS = 32;
const defaultUid = (): number | undefined => (typeof process.getuid === 'function' ? process.getuid() : undefined);

/** Probes an existing endpoint: `live` when something accepts a connection. */
export function probeLocalSocket(path: string, timeoutMs = 1_000): Promise<'live' | 'dead'> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    const timer = setTimeout(() => { socket.destroy(); resolve('live'); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve('live'); });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT' || error.code === 'ENOTSOCK') resolve('dead');
      else reject(error);
    });
  });
}

/**
 * Checks the socket's directory and any existing socket, removing a stale one. Throws
 * {@link LocalSocketError} when another live gateway owns the path or ownership is wrong.
 */
export async function prepareLocalSocketPath(path: string, options: LocalSocketSecurityOptions = {}): Promise<{ readonly removedStale: boolean }> {
  const probe = (): Promise<'live' | 'dead'> => probeLocalSocket(path, options.probeTimeoutMs);
  if (isNamedPipe(path)) {
    if (await probe() === 'live') throw new LocalSocketError('in_use', `另一个网关正在使用 ${path}`);
    return { removedStale: false };
  }
  const uid = (options.uid ?? defaultUid)();
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new LocalSocketError('insecure_dir', `${directory} 不是目录`);
  const sticky = (dir.mode & 0o1000) !== 0;
  if (!sticky) {
    if (uid !== undefined && dir.uid !== uid) {
      throw new LocalSocketError('insecure_dir', `${directory} 属于其他用户（uid ${dir.uid}），拒绝在其中创建控制套接字`);
    }
    if ((dir.mode & 0o022) !== 0) {
      throw new LocalSocketError('insecure_dir', `${directory} 可被其他用户写入（mode ${(dir.mode & 0o777).toString(8)}）；请执行 chmod go-w ${directory}`);
    }
  }
  let existing;
  try { existing = await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removedStale: false };
    throw error;
  }
  if (!existing.isSocket()) throw new LocalSocketError('not_socket', `${path} 已存在且不是套接字，拒绝覆盖`);
  if (uid !== undefined && existing.uid !== uid) {
    throw new LocalSocketError('not_owner', `${path} 属于其他用户（uid ${existing.uid}）；请以启动网关的用户运行`);
  }
  if (await probe() === 'live') throw new LocalSocketError('in_use', `另一个网关正在使用 ${path}`);
  await rm(path, { force: true });
  return { removedStale: true };
}

/** The listening control server. */
export class LocalControlServer {
  readonly path: string;
  readonly #server: Server;
  readonly #sockets = new Set<Socket>();
  #handler: LocalRequestHandler | undefined;
  #inode: number | undefined;
  #closed: Promise<void> | undefined;

  private constructor(path: string, server: Server, handler: LocalRequestHandler | undefined) {
    this.path = path;
    this.#server = server;
    this.#handler = handler;
  }

  /** Validates the path, removes a stale socket, then listens with mode 0600. */
  static async open(options: LocalControlServerOptions): Promise<LocalControlServer> {
    await prepareLocalSocketPath(options.path, options);
    const server = createServer();
    server.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    const control = new LocalControlServer(options.path, server, options.handler);
    server.on('connection', (socket) => { control.#accept(socket); });
    await control.#listen(options);
    return control;
  }

  setHandler(handler: LocalRequestHandler): void { this.#handler = handler; }

  /** Stops accepting, drops connections and removes the socket file it created. */
  close(): Promise<void> {
    this.#closed ??= (async () => {
      for (const socket of this.#sockets) socket.destroy();
      await new Promise<void>((resolve) => { this.#server.close(() => resolve()); });
      if (isNamedPipe(this.path) || this.#inode === undefined) return;
      try {
        // Only remove the file this server bound (a successor may have replaced it).
        if ((await lstat(this.path)).ino === this.#inode) await rm(this.path, { force: true });
      } catch { /* already gone */ }
    })();
    return this.#closed;
  }

  async #listen(options: LocalControlServerOptions): Promise<void> {
    const pipe = isNamedPipe(this.path);
    let previousMask: number | undefined;
    // The bind happens synchronously inside listen(): the socket is created 0600.
    if (!pipe) { try { previousMask = process.umask(0o177); } catch { /* workers cannot set umask */ } }
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => { reject(error); };
        this.#server.once('error', onError);
        try {
          this.#server.listen(this.path, () => { this.#server.off('error', onError); resolve(); });
        } finally {
          if (previousMask !== undefined) { process.umask(previousMask); previousMask = undefined; }
        }
      });
    } finally {
      if (previousMask !== undefined) process.umask(previousMask);
    }
    if (pipe) return;
    await chmod(this.path, 0o600);
    const bound = await stat(this.path);
    if ((bound.mode & 0o077) !== 0) {
      await this.close();
      throw new LocalSocketError('insecure_socket', `无法把 ${this.path} 限制为仅当前用户可访问`);
    }
    this.#inode = bound.ino;
  }

  #accept(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding('utf8');
    const decoder = new LineDecoder();
    const write = (line: LocalGatewayServerLine): void => {
      if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(line)}\n`);
    };
    socket.on('data', (chunk: string) => {
      let lines: string[];
      try { lines = decoder.push(chunk); } catch {
        write({ id: 0, ok: false, error: { code: 'invalid_input', message: '请求过长', status: 400 } });
        socket.end();
        return;
      }
      for (const line of lines) void this.#handle(line, write);
    });
    socket.on('error', () => { socket.destroy(); });
    socket.on('close', () => { this.#sockets.delete(socket); });
  }

  async #handle(line: string, write: (line: LocalGatewayServerLine) => void): Promise<void> {
    let request: LocalGatewayRequest;
    try {
      const parsed = JSON.parse(line) as Partial<LocalGatewayRequest>;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string'
        || (typeof parsed.id !== 'number' && typeof parsed.id !== 'string')) throw new Error('shape');
      request = parsed as LocalGatewayRequest;
    } catch {
      write({ id: 0, ok: false, error: { code: 'invalid_input', message: '请求不是有效的 JSON 行', status: 400 } });
      return;
    }
    const handler = this.#handler;
    if (!handler) {
      write({ id: request.id, ok: false, error: { code: 'unavailable', message: '网关正在启动', status: 503 } });
      return;
    }
    try {
      const result = await handler(request, (event) => { write({ id: request.id, event }); });
      write({ id: request.id, ...result } as LocalGatewayServerLine);
    } catch {
      write({ id: request.id, ok: false, error: { code: 'internal', message: '网关内部错误', status: 500 } });
    }
  }
}
