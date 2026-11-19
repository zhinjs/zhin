/**
 * Off-thread Page/Layout static metadata (#1250).
 *
 * `extractPageMetadata` / `assertLayoutModule` parse with the TypeScript compiler. Loaded on the
 * main thread, TypeScript stays resident for the life of the process (V8 keeps the compiled
 * script in its compilation cache even after the module is dropped): ~18 MB heap and ~77 MB RSS
 * in a long-running instance that only compiles Console pages at startup and on hot reload.
 * The builder therefore runs those parses in a short-lived worker thread: the worker loads
 * TypeScript once per burst of compiles and is terminated after {@link WORKER_IDLE_MS} of
 * inactivity, which releases its whole isolate. When a worker cannot be started the parse runs
 * in-process, as before.
 *
 * Internal to `@zhin.js/pagemanager` (not re-exported from the package index).
 */
import { Worker } from 'node:worker_threads';
import { assertLayoutModule, ClientSourceError, extractPageMetadata } from './static-metadata.js';

export type ClientMetadataKind = 'page' | 'layout';

/** Idle time after which the metadata worker (and the TypeScript compiler in it) is released. */
const WORKER_IDLE_MS = 2_000;

interface WorkerRequest {
  readonly id: number;
  readonly kind: ClientMetadataKind;
  readonly source: string;
  readonly fileName: string;
}

interface SerializedError {
  readonly name?: string;
  readonly message: string;
  readonly source?: string;
  readonly line?: number;
  readonly column?: number;
  readonly causeCode?: string;
}

type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedError; readonly loadFailure?: boolean };

/**
 * Worker body (CommonJS, `eval: true`). It imports this package's own `static-metadata` module —
 * the compiled `.js` in production, the `.ts` source (Node type stripping) when the package runs
 * from sources — so both threads share one implementation.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const loaded = import(workerData.moduleUrl).then((module) => ({ module }), (error) => ({ error }));
const serialize = (error) => ({
  name: error && error.name,
  message: String(error && error.message !== undefined ? error.message : error),
  source: error && error.source,
  line: error && error.line,
  column: error && error.column,
  causeCode: error && error.cause && error.cause.code,
});
parentPort.on('message', async (request) => {
  const state = await loaded;
  if (state.error) {
    parentPort.postMessage({ id: request.id, ok: false, loadFailure: true, error: serialize(state.error) });
    return;
  }
  try {
    const value = request.kind === 'page'
      ? state.module.extractPageMetadata(request.source, request.fileName)
      : (state.module.assertLayoutModule(request.source, request.fileName), undefined);
    parentPort.postMessage({ id: request.id, ok: true, value });
  } catch (error) {
    parentPort.postMessage({ id: request.id, ok: false, error: serialize(error) });
  }
});
`;

interface PendingRequest {
  readonly request: WorkerRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

let worker: Worker | undefined;
let workerUnavailable = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function staticMetadataModuleUrl(): string {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./static-metadata${extension}`, import.meta.url).href;
}

function readInProcess(kind: ClientMetadataKind, source: string, fileName: string): unknown {
  if (kind === 'page') return extractPageMetadata(source, fileName);
  assertLayoutModule(source, fileName);
  return undefined;
}

function deserializeError(error: SerializedError): Error {
  if (
    error.name === 'ClientSourceError'
    && typeof error.source === 'string'
    && typeof error.line === 'number'
    && typeof error.column === 'number'
  ) {
    const prefix = `${error.source}:${error.line}:${error.column} `;
    const reason = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
    return new ClientSourceError(error.source, error.line, error.column, reason);
  }
  const cause = error.causeCode ? Object.assign(new Error(error.causeCode), { code: error.causeCode }) : undefined;
  const result = new Error(error.message, cause ? { cause } : undefined);
  if (error.name && error.name !== 'Error') result.name = error.name;
  return result;
}

function stopWorker(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const current = worker;
  worker = undefined;
  if (current) void current.terminate().catch(() => undefined);
}

/** The worker died (crash, resource limits): answer what it still owed in-process. */
function failPending(current: Worker): void {
  if (worker === current) worker = undefined;
  for (const [id, entry] of pending) {
    pending.delete(id);
    try {
      entry.resolve(readInProcess(entry.request.kind, entry.request.source, entry.request.fileName));
    } catch (error) {
      entry.reject(error);
    }
  }
}

function settle(entry: PendingRequest, response: WorkerResponse): void {
  if (response.ok) {
    entry.resolve(response.value);
    return;
  }
  if (response.loadFailure) {
    // The worker cannot load the parser (e.g. no type stripping for a source checkout): parse
    // in-process from now on.
    workerUnavailable = true;
    stopWorker();
    try {
      entry.resolve(readInProcess(entry.request.kind, entry.request.source, entry.request.fileName));
    } catch (error) {
      entry.reject(error);
    }
    return;
  }
  entry.reject(deserializeError(response.error));
}

function startWorker(): Worker {
  const created = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { moduleUrl: staticMetadataModuleUrl() },
  });
  created.on('message', (response: WorkerResponse) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    settle(entry, response);
    scheduleIdle(created);
  });
  created.on('error', () => failPending(created));
  created.on('exit', () => failPending(created));
  return created;
}

function scheduleIdle(current: Worker): void {
  if (worker !== current || pending.size > 0) return;
  // An idle worker must not keep the process alive; a busy one must (a CLI build awaits it).
  current.unref();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (worker === current && pending.size === 0) stopWorker();
  }, WORKER_IDLE_MS);
  idleTimer.unref?.();
}

/**
 * Static metadata of a Page (`definePage` meta) or validation of a Layout, parsed off the main
 * thread. Same results and errors as {@link extractPageMetadata} / {@link assertLayoutModule}.
 */
export async function readClientMetadata(kind: ClientMetadataKind, source: string, fileName: string): Promise<unknown> {
  if (workerUnavailable) return readInProcess(kind, source, fileName);
  let current = worker;
  if (!current) {
    try {
      current = startWorker();
    } catch {
      workerUnavailable = true;
      return readInProcess(kind, source, fileName);
    }
    worker = current;
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  current.ref();
  const request: WorkerRequest = { id: nextId++, kind, source, fileName };
  return new Promise<unknown>((resolve, reject) => {
    pending.set(request.id, { request, resolve, reject });
    current.postMessage(request);
  });
}

/** Stops the metadata worker now (tests, shutdown). Internal. */
export function stopClientMetadataWorker(): void {
  stopWorker();
}

/** Whether a metadata worker is currently running. Internal; for tests. */
export function isClientMetadataWorkerRunning(): boolean {
  return worker !== undefined;
}
