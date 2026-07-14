/**
 * Session-scoped agent state — defineState runtime (ADR 0039 P2).
 * In-memory per sessionId; not durable across restarts (P3 workflow ADR).
 */

export type StateInitialFn<T> = T | (() => T);

export interface RegisteredAuthoringState {
  runtimeName: string;
  pluginName: string;
  initial: () => unknown;
}

const stateDefs = new Map<string, RegisteredAuthoringState>();
const sessionBuckets = new Map<string, Map<string, unknown>>();

export function resetAgentStateStoreForTests(): void {
  stateDefs.clear();
  sessionBuckets.clear();
}

export function registerAuthoringState(entry: RegisteredAuthoringState): void {
  stateDefs.set(entry.runtimeName, entry);
}

export function listRegisteredAuthoringStates(): RegisteredAuthoringState[] {
  return [...stateDefs.values()];
}

function resolveInitial<T>(initial?: StateInitialFn<T>): T | undefined {
  if (initial === undefined) return undefined;
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

export function registerAuthoringStateFromDefinition(
  runtimeName: string,
  pluginName: string,
  initial?: StateInitialFn<unknown>,
): void {
  registerAuthoringState({
    runtimeName,
    pluginName,
    initial: () => resolveInitial(initial),
  });
}

export function getAgentState<T = unknown>(sessionId: string, name: string): T | undefined {
  const bucket = sessionBuckets.get(sessionId) ?? new Map<string, unknown>();
  if (!sessionBuckets.has(sessionId)) sessionBuckets.set(sessionId, bucket);
  if (!bucket.has(name)) {
    const def = stateDefs.get(name);
    if (def) bucket.set(name, def.initial());
  }
  return bucket.get(name) as T | undefined;
}

export function updateAgentState<T = unknown>(
  sessionId: string,
  name: string,
  updater: (prev: T | undefined) => T,
): T {
  const prev = getAgentState<T>(sessionId, name);
  const next = updater(prev);
  const bucket = sessionBuckets.get(sessionId)!;
  bucket.set(name, next);
  return next;
}

export function clearAgentStateSession(sessionId: string): void {
  sessionBuckets.delete(sessionId);
}
