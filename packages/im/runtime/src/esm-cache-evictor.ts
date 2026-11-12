/**
 * Best-effort eviction of retired module records from Node's ESM load cache.
 *
 * NativeDevelopmentModuleRuntime reloads with `?zhin-generation=N` URLs. Node
 * never forgets a loaded URL, so without eviction every retired generation's
 * module instances (and the state they export) stay reachable for the life of
 * the process. This module removes those URLs from the cascaded ModuleLoader's
 * `loadCache` once a generation has committed, so V8 can collect them.
 *
 * `loadCache` is a non-public field of Node's internal ModuleLoader. It is
 * reached by reading the `loader` variable from the closure of
 * `import.meta.resolve` through an in-process inspector session (no
 * `--inspect` flag needed). Every step is verified by shape; when any of it is
 * unavailable (Node without inspector, a changed internal layout, a non-native
 * loader such as Vitest) the evictor is `undefined` and HMR keeps its previous
 * behaviour. Eviction never decides correctness: running generations keep
 * their linked module instances whether or not the cache still names them.
 */

interface LoadCacheLike {
  keys(): IterableIterator<string>;
}

interface RemoteObject {
  readonly objectId?: string;
}

interface PropertyDescriptor {
  readonly name: string;
  readonly value?: RemoteObject;
}

interface Properties {
  readonly result: readonly PropertyDescriptor[];
  readonly internalProperties?: readonly PropertyDescriptor[];
}

export interface EsmCacheEvictor {
  /** URLs currently held by the ESM load cache. */
  urls(): string[];
  /** Removes every import-attribute slot cached for `url`. */
  evict(url: string): boolean;
}

/** Temporary global slot used to move values between the inspector and this realm. */
const probeKey = '__zhinEsmCacheEvictorProbe';
// Fixed source text sent to the inspector; nothing is interpolated into it.
const probeExpression = 'globalThis.__zhinEsmCacheEvictorProbe';
const probeAssignment = 'function () { globalThis.__zhinEsmCacheEvictorProbe = this }';

let cached: EsmCacheEvictor | null | undefined;

/** Returns the process-wide evictor, or `undefined` when this Node cannot provide one. */
export function getEsmCacheEvictor(): EsmCacheEvictor | undefined {
  if (cached === undefined) cached = createEvictor() ?? null;
  return cached ?? undefined;
}

function createEvictor(): EsmCacheEvictor | undefined {
  let loadCache: LoadCacheLike | undefined;
  try {
    loadCache = captureLoadCache();
  } catch {
    return undefined;
  }
  if (!loadCache) return undefined;
  const cache = loadCache;
  return Object.freeze({
    urls: () => Array.from(cache.keys()),
    // LoadCache#delete(url, type) only clears one attribute slot and keeps the
    // key. Delete the whole URL entry through the underlying Map instead.
    evict: (url: string) => Map.prototype.delete.call(cache, url),
  });
}

function captureLoadCache(): LoadCacheLike | undefined {
  const resolver = import.meta.resolve as unknown;
  if (typeof resolver !== 'function') return undefined;
  const inspector = process.getBuiltinModule?.('node:inspector') as
    | typeof import('node:inspector')
    | undefined;
  if (!inspector?.Session) return undefined;

  const session = new inspector.Session();
  session.connect();
  const scope = globalThis as Record<string, unknown>;
  // An in-process session answers Runtime commands synchronously. This is
  // Node behaviour, not an API promise, so a missing reply aborts capture.
  const post = <T>(method: string, params: Record<string, unknown>): T => {
    let failure: Error | null = null;
    let reply: T | undefined;
    session.post(method, params, (error, result) => {
      failure = error;
      reply = result as T;
    });
    if (failure) throw failure;
    if (reply === undefined) throw new Error(`inspector did not reply synchronously to ${method}`);
    return reply;
  };
  const pull = (objectId: string): unknown => {
    post('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: probeAssignment,
    });
    return scope[probeKey];
  };

  try {
    scope[probeKey] = resolver;
    const target = post<{ result: RemoteObject }>('Runtime.evaluate', { expression: probeExpression })
      .result.objectId;
    if (!target) return undefined;
    const scopes = post<Properties>('Runtime.getProperties', { objectId: target })
      .internalProperties?.find((property) => property.name === '[[Scopes]]')?.value?.objectId;
    if (!scopes) return undefined;
    for (const closure of post<Properties>('Runtime.getProperties', { objectId: scopes }).result) {
      const closureId = closure.value?.objectId;
      if (!closureId) continue;
      const loaderId = post<Properties>('Runtime.getProperties', { objectId: closureId }).result
        .find((variable) => variable.name === 'loader')?.value?.objectId;
      if (!loaderId) continue;
      const loadCache = (pull(loaderId) as { loadCache?: unknown } | null)?.loadCache;
      if (isLoadCache(loadCache)) return loadCache;
    }
    return undefined;
  } finally {
    delete scope[probeKey];
    session.disconnect();
  }
}

function isLoadCache(value: unknown): value is LoadCacheLike {
  // Builtins use primordials' SafeMap, which is not on the user-land Map
  // prototype chain, so the check is structural.
  const candidate = value as Partial<Map<string, unknown>> | null | undefined;
  return typeof candidate?.keys === 'function'
    && typeof candidate.delete === 'function'
    && typeof candidate.get === 'function';
}
