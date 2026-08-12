/**
 * JournalStore — persistent backend for AgentRunJournal.
 *
 * Implementations must guarantee:
 * 1. append() is crash-safe: a committed event survives process restart.
 * 2. replay() returns events in sequence order.
 * 3. append() atomically rejects a stale expectedPreviousSequence.
 * 4. Concurrent appends to different runs are safe.
 */
import type { AgentRunEvent, AgentRunIdentity } from './agent-stream.js';

export interface JournalRunSummary {
  readonly run: AgentRunIdentity;
  readonly eventCount: number;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly terminal?: string;
}

export interface JournalStore {
  append(event: AgentRunEvent, expectedPreviousSequence: number): void | Promise<void>;
  replay(run: AgentRunIdentity, afterSequence?: number): Promise<readonly AgentRunEvent[]>;
  listRuns(sessionId: string): Promise<readonly JournalRunSummary[]>;
}
