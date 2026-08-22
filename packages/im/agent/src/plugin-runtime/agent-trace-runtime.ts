import { randomUUID } from 'node:crypto';
import type { TurnEvent } from '../event/turn-event.js';

export interface AgentTraceEvent {
  readonly runtimeId: string;
  readonly sequence: number;
  readonly recordedAt: number;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly type: TurnEvent['type'];
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AgentTraceSnapshot {
  readonly runtimeId: string;
  readonly sessionKey: string;
  readonly events: readonly AgentTraceEvent[];
  readonly latestSequence: number;
  readonly activeTurnIds: readonly string[];
}

export interface AgentTraceRuntimeHandle {
  list(
    sessionKey: string,
    options?: Readonly<{ afterSequence?: number; limit?: number }>,
  ): AgentTraceSnapshot;
}

export interface AgentTraceRecorder extends AgentTraceRuntimeHandle {
  record(sessionKey: string, turnId: string, event: TurnEvent): void;
}

interface SessionTraceBuffer {
  readonly events: AgentTraceEvent[];
  readonly activeTurnIds: Set<string>;
  latestSequence: number;
  touchedAt: number;
}

const secretKeys = new Set([
  'authorization',
  'cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'apikey',
  'privatekey',
]);
const terminalTypes = new Set<TurnEvent['type']>([
  'turn_end',
  'error',
  'turn_cancelled',
  'budget_exceeded',
]);

/**
 * Generation-owned, bounded operational projection for Console. It deliberately
 * drops token chunks: the terminal output is retained, while token streaming
 * would otherwise drown the useful tool/iteration lifecycle in noise.
 */
export function createAgentTraceRuntime(options: Readonly<{
  maxSessions?: number;
  maxEventsPerSession?: number;
  now?: () => number;
}> = {}): AgentTraceRecorder {
  const maxSessions = positiveInteger(options.maxSessions, 100);
  const maxEventsPerSession = positiveInteger(options.maxEventsPerSession, 500);
  const now = options.now ?? Date.now;
  const runtimeId = randomUUID();
  const sessions = new Map<string, SessionTraceBuffer>();

  const requireBuffer = (sessionKey: string): SessionTraceBuffer => {
    const existing = sessions.get(sessionKey);
    if (existing) return existing;
    evictOldestSession(sessions, maxSessions);
    const created: SessionTraceBuffer = {
      events: [],
      activeTurnIds: new Set(),
      latestSequence: 0,
      touchedAt: now(),
    };
    sessions.set(sessionKey, created);
    return created;
  };

  return Object.freeze({
    record(sessionKey: string, turnId: string, event: TurnEvent): void {
      if (!sessionKey || !turnId || event.type === 'chunk') return;
      const buffer = requireBuffer(sessionKey);
      const recordedAt = now();
      buffer.touchedAt = recordedAt;
      buffer.latestSequence += 1;
      if (event.type === 'turn_start') buffer.activeTurnIds.add(turnId);
      if (terminalTypes.has(event.type)) buffer.activeTurnIds.delete(turnId);
      buffer.events.push(Object.freeze({
        runtimeId,
        sequence: buffer.latestSequence,
        recordedAt,
        sessionKey,
        turnId,
        type: event.type,
        data: sanitizeEvent(event),
      }));
      if (buffer.events.length > maxEventsPerSession) {
        buffer.events.splice(0, buffer.events.length - maxEventsPerSession);
      }
    },
    list(
      sessionKey: string,
      listOptions: Readonly<{ afterSequence?: number; limit?: number }> = {},
    ): AgentTraceSnapshot {
      const buffer = sessions.get(sessionKey);
      if (!buffer) return emptySnapshot(runtimeId, sessionKey);
      buffer.touchedAt = now();
      const afterSequence = nonNegativeInteger(listOptions.afterSequence, 0);
      const limit = Math.min(positiveInteger(listOptions.limit, 200), maxEventsPerSession);
      const events = buffer.events.filter((event) => event.sequence > afterSequence).slice(-limit);
      return Object.freeze({
        runtimeId,
        sessionKey,
        events: Object.freeze([...events]),
        latestSequence: buffer.latestSequence,
        activeTurnIds: Object.freeze([...buffer.activeTurnIds]),
      });
    },
  });
}

function sanitizeEvent(event: TurnEvent): Readonly<Record<string, unknown>> {
  const { type: _type, ...data } = event;
  return Object.freeze(sanitizeRecord(data, 0));
}

function sanitizeRecord(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).slice(0, 50).map(([key, item]) => [
      key,
      isSecretKey(key) ? '[redacted]' : sanitizeValue(item, depth + 1),
    ]),
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncate(value, 4_000);
  if (value instanceof Error) return Object.freeze({
    name: value.name,
    message: truncate(value.message, 2_000),
  });
  if (depth >= 5) return '[max depth]';
  if (Array.isArray(value)) return Object.freeze(value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1)));
  if (typeof value === 'object') return Object.freeze(sanitizeRecord(value as Record<string, unknown>, depth));
  return truncate(String(value), 500);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}… [truncated]`;
}

function isSecretKey(key: string): boolean {
  return secretKeys.has(key.replaceAll('-', '').replaceAll('_', '').toLowerCase());
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function emptySnapshot(runtimeId: string, sessionKey: string): AgentTraceSnapshot {
  return Object.freeze({
    runtimeId,
    sessionKey,
    events: Object.freeze([]),
    latestSequence: 0,
    activeTurnIds: Object.freeze([]),
  });
}

function evictOldestSession(sessions: Map<string, SessionTraceBuffer>, maxSessions: number): void {
  if (sessions.size < maxSessions) return;
  let oldest: [string, SessionTraceBuffer] | undefined;
  for (const entry of sessions) {
    if (!oldest || entry[1].touchedAt < oldest[1].touchedAt) oldest = entry;
  }
  if (oldest) sessions.delete(oldest[0]);
}
