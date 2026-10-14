/**
 * Process-local wiring between running turns and their TurnTraceCollector.
 *
 * Every TurnEvent of a turn — engine stream events and the tool events that
 * TurnToolRuntime writes straight to the journal (see #740) — passes through
 * the turn's journal port, so wrapping that port is the one place that sees
 * the whole turn. Sub-agent turns share the parent's journal; their events
 * are tagged with the child turn id so the parent trace can nest them.
 */
import type { TurnEvent } from '../event/turn-event.js';
import type { TurnJournalPort } from '../turn/turn-ingress.js';
import type { TurnTraceCollector, TurnTraceNote } from './turn-trace.js';

interface TraceScope {
  readonly turnId: string;
  readonly sessionKey: string;
}

const activeCollectors = new Map<string, TurnTraceCollector>();
const eventScopes = new WeakMap<object, TraceScope>();

/** Journal port that feeds the collector before delegating to the real journal. */
export function createTracingJournal(journal: TurnJournalPort, collector: TurnTraceCollector): TurnJournalPort {
  return Object.freeze({
    append(event: TurnEvent) {
      const scope = eventScopes.get(event);
      const target = scope && scope.turnId !== collector.turnId
        ? collector.child(scope.turnId, scope.sessionKey)
        : collector;
      try {
        target.record(event);
      } catch {
        // Tracing is a projection; it must never fail the turn.
      }
      return journal.append(event);
    },
  });
}

/** Journal port for a sub-agent turn: tags events with the child turn id. */
export function createScopedTraceJournal(
  journal: TurnJournalPort,
  scope: Readonly<{ turnId: string; sessionKey: string }>,
): TurnJournalPort {
  const frozen = Object.freeze({ turnId: scope.turnId, sessionKey: scope.sessionKey });
  return Object.freeze({
    append(event: TurnEvent) {
      if (!eventScopes.has(event)) eventScopes.set(event, frozen);
      return journal.append(event);
    },
  });
}

/** Makes a root collector reachable for trace notes until the returned release runs. */
export function registerTurnTrace(collector: TurnTraceCollector): () => void {
  activeCollectors.set(collector.turnId, collector);
  return () => {
    if (activeCollectors.get(collector.turnId) === collector) activeCollectors.delete(collector.turnId);
  };
}

/**
 * Records a non-event fact (budget extension, auto-continuation) on the turn
 * with this id, including nested `<parent>:subagent:<n>` turns. No-op when
 * the turn is not traced.
 */
export function noteTurnTrace(turnId: string | undefined, note: TurnTraceNote): void {
  if (!turnId) return;
  const rootId = turnId.split(':subagent:')[0] ?? turnId;
  const root = activeCollectors.get(rootId);
  const target = root?.find(turnId) ?? (root && turnId !== rootId ? root.child(turnId) : undefined);
  try {
    target?.note(note);
  } catch {
    // Projection only.
  }
}
