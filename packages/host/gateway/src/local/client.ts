/** CLI side of the local control socket (ADR 0054 §6). */
import { lstat } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import type { GatewayPackageEvent, GatewayRpcErrorDetails } from '@zhin.js/console-protocol';
import { gatewaySocketPath, isNamedPipe } from './paths.js';
import {
  LineDecoder,
  LOCAL_GATEWAY_RPC,
  type LocalGatewayErrorCode,
  type LocalGatewayHttpMethod,
  type LocalGatewayHttpResponse,
  type LocalGatewayInfoResult,
  type LocalGatewayServerLine,
} from './protocol.js';
import { readGatewayInfo } from './state-file.js';

/**
 * - `not_running`: no socket, or a stale one nobody listens on;
 * - `not_owner`: the socket belongs to (or is only accessible by) another user;
 * - `unreachable`: a socket exists but the gateway does not answer;
 * - `protocol`: the peer sent something that is not the gateway protocol.
 */
export type LocalGatewayClientErrorCode = 'not_running' | 'not_owner' | 'unreachable' | 'protocol';

export class LocalGatewayClientError extends Error {
  constructor(readonly code: LocalGatewayClientErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalGatewayClientError';
  }
}

/** The gateway answered `{ ok: false }`. */
export class LocalGatewayRpcError extends Error {
  constructor(readonly code: LocalGatewayErrorCode, message: string, readonly status: number, readonly details: GatewayRpcErrorDetails = {}) {
    super(message);
    this.name = 'LocalGatewayRpcError';
  }
}

export interface LocalGatewayClientOptions {
  readonly root: string;
  /** Overrides the endpoint (default: `gateway.json#socket`, else {@link gatewaySocketPath}). */
  readonly path?: string;
  /** Current user id; `undefined` skips the owner check. Default `process.getuid()`. */
  readonly uid?: () => number | undefined;
  readonly connectTimeoutMs?: number;
}

export interface LocalRequestOptions {
  readonly onEvent?: (event: GatewayPackageEvent) => void;
  /** Default: none (package transactions can take minutes). */
  readonly timeoutMs?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onEvent?: (event: GatewayPackageEvent) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const defaultUid = (): number | undefined => (typeof process.getuid === 'function' ? process.getuid() : undefined);

export class LocalGatewayClient {
  readonly path: string;
  readonly #socket: Socket;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closedError: Error | undefined;

  private constructor(path: string, socket: Socket) {
    this.path = path;
    this.#socket = socket;
    const decoder = new LineDecoder();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      let lines: string[];
      try { lines = decoder.push(chunk); } catch (error) {
        this.#fail(new LocalGatewayClientError('protocol', '网关返回的数据过长', { cause: error }));
        return;
      }
      for (const line of lines) this.#receive(line);
    });
    socket.on('error', (error) => { this.#fail(new LocalGatewayClientError('unreachable', `与网关的连接出错：${error.message}`, { cause: error })); });
    socket.on('close', () => { this.#fail(new LocalGatewayClientError('unreachable', '网关关闭了连接')); });
  }

  /** Connects to the project's gateway; see {@link LocalGatewayClientErrorCode} for failures. */
  static async connect(options: LocalGatewayClientOptions): Promise<LocalGatewayClient> {
    const path = options.path ?? (await readGatewayInfo(options.root))?.socket ?? gatewaySocketPath(options.root);
    if (!isNamedPipe(path)) {
      let info;
      try { info = await lstat(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LocalGatewayClientError('not_running', '网关未运行');
        throw new LocalGatewayClientError('unreachable', `无法读取 ${path}：${(error as Error).message}`, { cause: error });
      }
      if (!info.isSocket()) throw new LocalGatewayClientError('protocol', `${path} 不是网关控制套接字`);
      const uid = (options.uid ?? defaultUid)();
      if (uid !== undefined && info.uid !== uid) {
        throw new LocalGatewayClientError('not_owner', `${path} 属于其他用户（uid ${info.uid}），当前用户 uid ${uid}；请以启动网关的用户运行 zhin`);
      }
    }
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect(path);
      const timer = setTimeout(() => {
        candidate.destroy();
        reject(new LocalGatewayClientError('unreachable', `连接网关超时（${path}）`));
      }, options.connectTimeoutMs ?? 5_000);
      candidate.once('connect', () => { clearTimeout(timer); resolve(candidate); });
      candidate.once('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') reject(new LocalGatewayClientError('not_running', '网关未运行（套接字已失效）', { cause: error }));
        else if (error.code === 'EACCES' || error.code === 'EPERM') reject(new LocalGatewayClientError('not_owner', `无权访问 ${path}；请以启动网关的用户运行 zhin`, { cause: error }));
        else reject(new LocalGatewayClientError('unreachable', `无法连接网关：${error.message}`, { cause: error }));
      });
    });
    return new LocalGatewayClient(path, socket);
  }

  request<T = unknown>(type: string, data?: unknown, options: LocalRequestOptions = {}): Promise<T> {
    if (this.#closedError) return Promise.reject(this.#closedError);
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: resolve as (value: unknown) => void, reject, ...(options.onEvent ? { onEvent: options.onEvent } : {}) };
      if (options.timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new LocalGatewayClientError('unreachable', `网关在 ${options.timeoutMs} ms 内没有响应 ${type}`));
        }, options.timeoutMs);
      }
      this.#pending.set(id, pending);
      this.#socket.write(`${JSON.stringify({ id, type, ...(data === undefined ? {} : { data }) })}\n`);
    });
  }

  info(timeoutMs = 10_000): Promise<LocalGatewayInfoResult> {
    return this.request<LocalGatewayInfoResult>(LOCAL_GATEWAY_RPC.INFO, undefined, { timeoutMs });
  }

  close(): void {
    this.#closedError ??= new LocalGatewayClientError('unreachable', '连接已关闭');
    this.#socket.destroy();
  }

  #receive(text: string): void {
    let line: LocalGatewayServerLine;
    try { line = JSON.parse(text) as LocalGatewayServerLine; } catch {
      this.#fail(new LocalGatewayClientError('protocol', '网关返回了无效的 JSON'));
      return;
    }
    const pending = typeof line?.id === 'number' ? this.#pending.get(line.id) : undefined;
    if (!pending) return;
    if ('event' in line) {
      try { pending.onEvent?.(line.event); } catch { /* a faulty listener must not break the stream */ }
      return;
    }
    this.#pending.delete(line.id as number);
    clearTimeout(pending.timer);
    if (line.ok) pending.resolve(line.data);
    else {
      const { errors, missingEnv } = line.error;
      pending.reject(new LocalGatewayRpcError(line.error.code, line.error.message, line.error.status, {
        ...(Array.isArray(errors) && errors.length ? { errors } : {}),
        ...(Array.isArray(missingEnv) && missingEnv.length ? { missingEnv } : {}),
      }));
    }
  }

  #fail(error: Error): void {
    this.#closedError ??= error;
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#socket.destroy();
  }
}

/**
 * The running gateway's info, or `undefined` when no gateway runs for `root`. Ownership and
 * reachability problems are thrown (a caller must not fall back to working on the files then).
 */
export async function probeLocalGateway(options: LocalGatewayClientOptions): Promise<LocalGatewayInfoResult | undefined> {
  let client: LocalGatewayClient;
  try { client = await LocalGatewayClient.connect(options); } catch (error) {
    if (error instanceof LocalGatewayClientError && error.code === 'not_running') return undefined;
    throw error;
  }
  try { return await client.info(); } finally { client.close(); }
}

/** The subset of `fetch` the CLI's Host clients use. */
export type LocalGatewayFetch = (input: string | URL, init?: Readonly<{ method?: string; body?: string | null; signal?: AbortSignal | null; headers?: unknown }>) => Promise<Response>;

/**
 * A `fetch` that sends `{base}/…` requests over the local control socket
 * (`gateway.http.request`) instead of HTTP: the gateway runs them as the local owner, so no
 * Console token is needed (ADR 0054 §6). Only the path and query of the URL are used. A gateway
 * that is not running rejects like a refused connection (`cause.code === 'ECONNREFUSED'`).
 */
export function createLocalGatewayFetch(options: LocalGatewayClientOptions): LocalGatewayFetch {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    const method = (init.method ?? 'GET').toUpperCase() as LocalGatewayHttpMethod;
    const body = typeof init.body === 'string' ? init.body : undefined;
    const signal = init.signal ?? undefined;
    signal?.throwIfAborted();
    let client: LocalGatewayClient;
    try { client = await LocalGatewayClient.connect(options); } catch (error) {
      if (error instanceof LocalGatewayClientError && error.code === 'not_running') {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(error.message), { code: 'ECONNREFUSED' }) });
      }
      throw error;
    }
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      signal.addEventListener('abort', () => { client.close(); reject(signal.reason); }, { once: true });
    });
    aborted.catch(() => undefined);
    try {
      const reply = await Promise.race([
        client.request<LocalGatewayHttpResponse>(LOCAL_GATEWAY_RPC.HTTP_REQUEST, { method, path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }) }),
        aborted,
      ]);
      return new Response(reply.body === '' ? null : reply.body, { status: reply.status, headers: reply.headers });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof LocalGatewayRpcError) {
        return new Response(JSON.stringify({ success: false, code: error.code, error: error.message }), { status: error.status, headers: { 'content-type': 'application/json' } });
      }
      throw error;
    } finally {
      client.close();
    }
  };
}
