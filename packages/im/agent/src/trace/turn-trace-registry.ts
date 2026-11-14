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
import { TurnTraceCollector, type TurnTrace, type TurnTraceNote, type TurnTraceTermination } from './turn-trace.js';

interface TraceScope {
  readonly turnId: string;
  readonly sessionKey: string;
}

/** Persists a finished trace that is no longer part of a live root trace. */
export type TurnTraceSave = (trace: TurnTrace) => void;

const activeCollectors = new Map<string, TurnTraceCollector>();
const traceSavers = new WeakMap<TurnTraceCollector, TurnTraceSave>();
/** Sub-turns traced by their own collector (#1250 trace-subagent-model-calls-missing). */
const subTurnCollectors = new Map<string, TurnTraceCollector>();
const eventScopes = new WeakMap<object, TraceScope>();

/** Journal port that feeds the collector before delegating to the real journal. */
export function createTracingJournal(journal: TurnJournalPort, collector: TurnTraceCollector): TurnJournalPort {
  return Object.freeze({
    append(event: TurnEvent) {
      const scope = eventScopes.get(event);
      const target = scope && scope.turnId !== collector.turnId
        ? subTurnCollectors.get(scope.turnId) ?? collector.child(scope.turnId, scope.sessionKey)
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

/** Turn id a sub-agent journal tagged this event with, if any. */
export function traceScopeTurnId(event: TurnEvent): string | undefined {
  return eventScopes.get(event)?.turnId;
}

/**
 * Makes a root collector reachable for trace notes until the returned release runs.
 * `save` persists sub-turn traces that finish after this root trace was saved.
 */
export function registerTurnTrace(collector: TurnTraceCollector, options: Readonly<{ save?: TurnTraceSave }> = {}): () => void {
  activeCollectors.set(collector.turnId, collector);
  if (options.save) traceSavers.set(collector, options.save);
  return () => {
    if (activeCollectors.get(collector.turnId) === collector) activeCollectors.delete(collector.turnId);
  };
}

/**
 * Records a non-event fact (budget extension, auto-continuation) on the turn
 * with this id, including nested `<root>:actor:<actor>:<mail>` turns. No-op when
 * the turn is not traced.
 */
export function noteTurnTrace(turnId: string | undefined, note: TurnTraceNote): void {
  if (!turnId) return;
  const own = subTurnCollectors.get(turnId);
  if (own) {
    try { own.note(note); } catch { /* Projection only. */ }
    return;
  }
  const rootId = turnId.split(':actor:')[0] ?? turnId;
  const root = activeCollectors.get(rootId);
  const target = root?.find(turnId) ?? (root && turnId !== rootId ? root.child(turnId) : undefined);
  try {
    target?.note(note);
  } catch {
    // Projection only.
  }
}

/** Trace of one sub-agent (actor) turn; see {@link captureSubTurnTracing}. */
export interface SubTurnTrace {
  readonly turnId: string;
  record(event: TurnEvent): void;
  note(note: TurnTraceNote): void;
  /** Nests the trace into the live root trace, or saves it on its own once the root trace was saved. */
  close(termination: TurnTraceTermination): void;
}

export interface SubTurnTracing {
  open(input: Readonly<{ turnId: string; sessionKey: string; principal?: ConstructorParameters<typeof TurnTraceCollector>[0]['principal'] }>): SubTurnTrace;
}

/**
 * Captured while the root turn runs (its trace is registered), so actor turns
 * that run after the root turn ended — background delegation results — still
 * get a trace with their model calls. `undefined` when the root turn is not traced.
 */
export function captureSubTurnTracing(rootTurnId: string): SubTurnTracing | undefined {
  const root = activeCollectors.get(rootTurnId);
  if (!root) return undefined;
  const save = traceSavers.get(root);
  return Object.freeze({
    open(input: Parameters<SubTurnTracing['open']>[0]) {
      const collector = new TurnTraceCollector({ turnId: input.turnId, sessionKey: input.sessionKey,
        ...(input.principal ? { principal: input.principal } : {}) });
      subTurnCollectors.set(input.turnId, collector);
      let closed = false;
      return Object.freeze({
        turnId: input.turnId,
        record(event: TurnEvent) {
          try { collector.record(event); } catch { /* Projection only. */ }
        },
        note(note: TurnTraceNote) {
          try { collector.note(note); } catch { /* Projection only. */ }
        },
        close(termination: TurnTraceTermination) {
          if (closed) return;
          closed = true;
          if (subTurnCollectors.get(input.turnId) === collector) subTurnCollectors.delete(input.turnId);
          try {
            collector.finalize(termination);
            if (activeCollectors.get(rootTurnId) === root && root.adopt(collector)) return;
            save?.(collector.snapshot());
          } catch {
            // Projection only: tracing never fails a turn.
          }
        },
      });
    },
  });
}
