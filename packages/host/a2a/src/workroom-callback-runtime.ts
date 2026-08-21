import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRouteHost } from '@zhin.js/host-http-contract';
import type {
  RemoteCallbackApplicationOutcome,
  RemoteExecutionLinkRecord,
  WorkroomCallbackAuthRegistry,
  WorkroomRemoteCallbackGatewayResult,
  WorkroomRemoteCallbackRequest,
} from '@zhin.js/agent';
import { WorkroomA2aAuthenticationError } from './workroom-auth-registry.js';

export interface RuntimeWorkroomCallbackDependencies {
  readonly authRegistry: Pick<WorkroomCallbackAuthRegistry, 'authenticate'>;
  readonly gateway: Readonly<{
    handle(
      request: WorkroomRemoteCallbackRequest,
      signal: AbortSignal,
    ): Promise<WorkroomRemoteCallbackGatewayResult>;
  }>;
  readonly linkRegistry: Readonly<{
    listRegistered(): Promise<readonly Pick<RemoteExecutionLinkRecord, 'id'>[]>;
  }>;
  readonly application: Readonly<{
    runOnce(linkId: string, signal: AbortSignal): Promise<RemoteCallbackApplicationOutcome>;
  }>;
}

export interface InstallRuntimeWorkroomCallbacksOptions {
  readonly http: HttpRouteHost;
  /** Exact route, intentionally separate from `/a2a/{agent}/*`. */
  readonly path?: string;
  readonly ordinaryA2aBasePath?: string;
  readonly dependencies: RuntimeWorkroomCallbackDependencies;
  readonly maxBodyBytes: number;
  readonly signal?: AbortSignal;
  /** Root handoff uses this so database-backed Workroom state activates first. */
  readonly deferRecovery?: boolean;
  readonly onRecoveryError?: (linkId: string, error: unknown) => void;
}

export interface RuntimeWorkroomCallbackRecoverySummary {
  readonly registered: number;
  readonly recovered: number;
  readonly failed: number;
}

export interface RuntimeWorkroomCallbackInstallation {
  readonly recovery: RuntimeWorkroomCallbackRecoverySummary | undefined;
  recover(signal?: AbortSignal): Promise<RuntimeWorkroomCallbackRecoverySummary>;
  dispose(): void;
}

/**
 * Installs the authority-isolated Workroom callback ingress. This route never
 * invokes the ordinary A2A Agent executor; accepted observations can reach
 * Workroom state only through the injected Callback Application.
 */
export async function installRuntimeWorkroomCallbacks(
  options: InstallRuntimeWorkroomCallbacksOptions,
): Promise<RuntimeWorkroomCallbackInstallation> {
  const path = normalizeExactPath(options.path ?? '/workroom-a2a/callback');
  const ordinaryA2aBasePath = normalizeBasePath(options.ordinaryA2aBasePath ?? '/a2a');
  if (ordinaryA2aBasePath === '/'
    || path === ordinaryA2aBasePath
    || path.startsWith(`${ordinaryA2aBasePath}/`)) {
    throw new Error('Workroom callback path must be outside ordinary A2A inbound');
  }
  const maxBodyBytes = positiveInteger(options.maxBodyBytes, 'maxBodyBytes');
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let recovery = options.deferRecovery === true
    ? undefined
    : await recoverRegisteredLinks(options.dependencies, signal, options.onRecoveryError);
  signal.throwIfAborted();

  const unregister = options.http.route('POST', path, async (request, response) => {
    const credential = bearerCredential(request);
    if (!credential) {
      writeJson(response, 401, { error: 'Unauthorized' });
      return;
    }
    // Authenticate before consuming attacker-controlled request bytes. The
    // Gateway authenticates again while deriving the immutable authority.
    try {
      options.dependencies.authRegistry.authenticate(credential);
    } catch {
      writeJson(response, 401, { error: 'Unauthorized' });
      return;
    }

    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(new Error('Callback request aborted'));
    request.once('aborted', abortRequest);
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    try {
      const body = await readRawBody(request, maxBodyBytes);
      const result = await options.dependencies.gateway.handle({ credential, body }, requestSignal);
      writeJson(response, 202, {
        accepted: true,
        duplicate: result.duplicate,
        applicationStatus: result.application.status,
      });
    } catch (error) {
      if (error instanceof WorkroomA2aAuthenticationError) {
        writeJson(response, 401, { error: 'Unauthorized' });
      } else if (error instanceof RuntimeWorkroomCallbackBodyError) {
        writeJson(
          response,
          error.statusCode,
          { error: error.message },
          error.closeConnection ? () => request.destroy() : undefined,
        );
      } else if (!response.headersSent && signal.aborted && !requestController.signal.aborted) {
        writeJson(response, 503, { error: 'Callback Host unavailable' });
      } else if (!response.headersSent && !requestSignal.aborted) {
        writeJson(response, 400, { error: 'Callback rejected' });
      }
    } finally {
      request.off('aborted', abortRequest);
    }
  }, {
    summary: 'Authenticated Workroom remote execution callback',
    tags: ['workroom', 'a2a-callback'],
  });

  let disposed = false;
  return Object.freeze({
    get recovery() { return recovery; },
    async recover(recoverySignal?: AbortSignal) {
      const activeSignal = recoverySignal
        ? AbortSignal.any([signal, recoverySignal])
        : signal;
      recovery = await recoverRegisteredLinks(
        options.dependencies,
        activeSignal,
        options.onRecoveryError,
      );
      return recovery;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort(new Error('Workroom callback Host retired'));
      unregister();
    },
  });
}

async function recoverRegisteredLinks(
  dependencies: RuntimeWorkroomCallbackDependencies,
  signal: AbortSignal,
  onRecoveryError: ((linkId: string, error: unknown) => void) | undefined,
): Promise<RuntimeWorkroomCallbackRecoverySummary> {
  signal.throwIfAborted();
  const records = [...await dependencies.linkRegistry.listRegistered()]
    .sort((left, right) => left.id.localeCompare(right.id));
  let recovered = 0;
  let failed = 0;
  for (const record of records) {
    signal.throwIfAborted();
    try {
      await dependencies.application.runOnce(record.id, signal);
      recovered += 1;
    } catch (error) {
      failed += 1;
      onRecoveryError?.(record.id, error);
    }
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  return Object.freeze({ registered: records.length, recovered, failed });
}

class RuntimeWorkroomCallbackBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413,
    readonly closeConnection = false,
  ) {
    super(message);
    this.name = 'RuntimeWorkroomCallbackBodyError';
  }
}

async function readRawBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declaredLength = declaredContentLength(request);
  if (declaredLength !== undefined && declaredLength > limit) {
    request.pause();
    throw new RuntimeWorkroomCallbackBodyError(
      `Callback body exceeds ${limit} bytes`,
      413,
      true,
    );
  }
  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    const buffered: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        request.pause();
        cleanup();
        reject(new RuntimeWorkroomCallbackBodyError(
          `Callback body exceeds ${limit} bytes`,
          413,
          true,
        ));
        return;
      }
      buffered.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      resolve(buffered);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAborted = () => {
      cleanup();
      reject(new Error('Callback request aborted'));
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
  if (chunks.length === 0) {
    throw new RuntimeWorkroomCallbackBodyError('Callback body is required', 400);
  }
  return Buffer.concat(chunks);
}

function declaredContentLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length'];
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function bearerCredential(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer ([^\s]+)$/u.exec(value);
  return match?.[1];
}

function normalizeExactPath(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Workroom callback path is required');
  }
  const leading = value.startsWith('/') ? value : `/${value}`;
  const normalized = leading.replace(/\/+$/u, '') || '/';
  if (normalized.includes('*')) throw new Error('Workroom callback path must be exact');
  return normalized;
}

function normalizeBasePath(value: string): string {
  return normalizeExactPath(value);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom callback ${field} must be a positive safe integer`);
  }
  return Number(value);
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  afterSend?: () => void,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...(afterSend ? { connection: 'close' } : {}),
  });
  response.end(body, afterSend);
}
