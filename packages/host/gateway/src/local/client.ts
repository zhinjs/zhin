/** CLI side of the local control socket (ADR 0054 §6). */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import type { GatewayPackageEvent, GatewayRpcErrorDetails } from '@zhin.js/console-protocol';
import { gatewaySocketPath, isNamedPipe } from './paths.js';
import {
  handshakeProof,
  LineDecoder,
  LOCAL_GATEWAY_RPC,
  MAX_LOCAL_HTTP_BODY_BYTES,
  MAX_LOCAL_LINE_BYTES,
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
  /**
   * Handshake key the endpoint must prove (default: `gateway.json#handshakeKey` when the endpoint
   * is the one recorded there). An endpoint that cannot prove it is refused (`not_owner`).
   */
  readonly handshakeKey?: string;
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
    const recorded = await readGatewayInfo(options.root);
    const path = options.path ?? recorded?.socket ?? gatewaySocketPath(options.root);
    const handshakeKey = options.handshakeKey ?? (recorded?.socket === path ? recorded.handshakeKey : undefined);
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
    const client = new LocalGatewayClient(path, socket);
    if (handshakeKey) {
      try { await client.#verify(handshakeKey); } catch (error) {
        client.close();
        throw error;
      }
    }
    return client;
  }

  /**
   * Proves the peer holds this run's handshake key. Node cannot restrict who creates a Windows
   * named pipe, so a pipe another account created first must not receive our requests.
   */
  async #verify(key: string): Promise<void> {
    const nonce = randomBytes(16).toString('hex');
    let reply: { proof?: unknown };
    try {
      reply = await this.request<{ proof?: unknown }>(LOCAL_GATEWAY_RPC.HELLO, { nonce }, { timeoutMs: 5_000 });
    } catch (error) {
      throw new LocalGatewayClientError('not_owner', `${this.path} 未通过网关握手校验；它可能不是本项目的网关`, { cause: error });
    }
    const expected = Buffer.from(handshakeProof(key, nonce), 'hex');
    const actual = typeof reply?.proof === 'string' && /^[0-9a-f]+$/u.test(reply.proof) ? Buffer.from(reply.proof, 'hex') : Buffer.alloc(0);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new LocalGatewayClientError('not_owner', `${this.path} 未通过网关握手校验；它可能不是本项目的网关`);
    }
  }

  request<T = unknown>(type: string, data?: unknown, options: LocalRequestOptions = {}): Promise<T> {
    if (this.#closedError) return Promise.reject(this.#closedError);
    const id = this.#nextId++;
    const line = `${JSON.stringify({ id, type, ...(data === undefined ? {} : { data }) })}\n`;
    if (Buffer.byteLength(line) > MAX_LOCAL_LINE_BYTES) {
      return Promise.reject(new LocalGatewayClientError('protocol', `请求超过本地套接字上限（1 MiB）：${type}`));
    }
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { resolve: resolve as (value: unknown) => void, reject, ...(options.onEvent ? { onEvent: options.onEvent } : {}) };
      if (options.timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new LocalGatewayClientError('unreachable', `网关在 ${options.timeoutMs} ms 内没有响应 ${type}`));
        }, options.timeoutMs);
      }
      this.#pending.set(id, pending);
      this.#socket.write(line);
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

/** The Bearer credential of `Authorization` in `headers` (a `Headers`, record or entry list). */
export function bearerFromHeaders(headers: unknown): string | undefined {
  let value: unknown;
  if (headers instanceof Headers) value = headers.get('authorization');
  else if (Array.isArray(headers)) {
    value = (headers as unknown[]).find((entry): entry is [string, string] => Array.isArray(entry) && String(entry[0]).toLowerCase() === 'authorization')?.[1];
  } else if (headers && typeof headers === 'object') {
    value = Object.entries(headers as Record<string, unknown>).find(([name]) => name.toLowerCase() === 'authorization')?.[1];
  }
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(value.trim());
  return match?.[1];
}

/** A JSON reply in the shape `requestPluginConsole` / `hostFetch` read. */
function localError(status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ success: false, code, error }), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A `fetch` that sends `{base}/…` requests over the local control socket
 * (`gateway.http.request`) instead of HTTP (ADR 0054 §6). Only the path and query of the URL are
 * used. Without an `Authorization: Bearer` header the gateway runs the request as the local
 * owner, so no Console token is needed; with one (an explicit `ZHIN_CONSOLE_TOKEN`), the gateway
 * authenticates that credential and runs — and audits — the request as its principal. A gateway
 * that is not running rejects like a refused connection (`cause.code === 'ECONNREFUSED'`).
 */
export function createLocalGatewayFetch(options: LocalGatewayClientOptions): LocalGatewayFetch {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    const method = (init.method ?? 'GET').toUpperCase() as LocalGatewayHttpMethod;
    const body = typeof init.body === 'string' ? init.body : undefined;
    const token = bearerFromHeaders(init.headers);
    const signal = init.signal ?? undefined;
    signal?.throwIfAborted();
    if (body !== undefined && (method === 'GET' || (method as string) === 'HEAD')) {
      return localError(400, 'invalid_input', 'GET 请求不能带 body');
    }
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body)) > MAX_LOCAL_HTTP_BODY_BYTES) {
      return localError(413, 'invalid_input', '请求体超过本地套接字上限；改用 HTTP 请求（Console API 令牌 ZHIN_CONSOLE_TOKEN，--host 指向网关地址）');
    }
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
        client.request<LocalGatewayHttpResponse>(LOCAL_GATEWAY_RPC.HTTP_REQUEST, {
          method,
          path: `${url.pathname}${url.search}`,
          ...(body === undefined ? {} : { body }),
          ...(token === undefined ? {} : { token }),
        }),
        aborted,
      ]);
      return new Response(reply.body === '' ? null : reply.body, { status: reply.status, headers: reply.headers });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof LocalGatewayRpcError) return localError(error.status, error.code, error.message);
      throw error;
    } finally {
      client.close();
    }
  };
}
