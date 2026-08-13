import type { Usage } from '@zhin.js/ai';
import type { TurnEvent, TurnTerminalEvent } from '../event/turn-event.js';
import type { TurnIngress, TurnOutcome } from './turn-ingress.js';
import { TurnTerminalGate } from './turn-terminal.js';

export type TurnEventSource = (turn: TurnIngress) => AsyncGenerator<TurnEvent, void>;
export type TurnEventObserver = (event: TurnEvent) => void | Promise<void>;

const emptyUsage: Usage = Object.freeze({
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
});

/**
 * Agent's single public execution algebra: one immutable ingress enters and
 * exactly one discriminated outcome leaves. Event observers are projections;
 * they cannot replace or fabricate the terminal result.
 */
export async function executeAgentTurn(
  turn: TurnIngress,
  run: TurnEventSource,
  observe?: TurnEventObserver,
): Promise<TurnOutcome> {
  const gate = new TurnTerminalGate();
  let observedUsage = emptyUsage;
  try {
    for await (const event of run(turn)) {
      try {
        await turn.ports.journal.append(event);
      } catch (error) {
        return failedOutcome('turn_journal_commit_failed', error, true, observedUsage);
      }
      if (!gate.accept(event)) continue;
      if (event.type === 'usage') observedUsage = addUsage(observedUsage, event.usage);
      try {
        await observe?.(event);
      } catch {
        // Observers are projections. Once an event is accepted by the terminal
        // gate, projection failure cannot rewrite the execution fact.
      }
      if (gate.terminal) break;
    }
  } catch (error) {
    if (gate.terminal) return outcomeFromTerminal(gate.terminal, observedUsage);
    const terminal: TurnTerminalEvent = turn.signal.aborted
      ? {
          type: 'turn_cancelled',
          code: 'cancelled',
          reason: errorMessage(turn.signal.reason ?? error, 'cancelled'),
        }
      : {
          type: 'error',
          code: 'turn_engine_failed',
          error: asError(error),
          recoverable: true,
        };
    return commitSyntheticTerminal(turn, gate, terminal, observedUsage);
  }

  if (gate.terminal) return outcomeFromTerminal(gate.terminal, observedUsage);
  return commitSyntheticTerminal(turn, gate, {
    type: 'error',
    code: 'turn_terminal_missing',
    error: new Error('Agent turn engine ended without a terminal event'),
    recoverable: false,
  }, observedUsage);
}

async function commitSyntheticTerminal(
  turn: TurnIngress,
  gate: TurnTerminalGate,
  terminal: TurnTerminalEvent,
  usage: Usage,
): Promise<TurnOutcome> {
  try {
    await turn.ports.journal.append(terminal);
  } catch (error) {
    return failedOutcome('turn_journal_commit_failed', error, true, usage);
  }
  if (!gate.accept(terminal) || !gate.terminal) {
    return failedOutcome(
      'turn_terminal_commit_rejected',
      new Error('Turn terminal gate rejected a synthesized terminal fact'),
      false,
      usage,
    );
  }
  return outcomeFromTerminal(gate.terminal, usage);
}

function outcomeFromTerminal(event: TurnTerminalEvent, observedUsage: Usage): TurnOutcome {
  switch (event.type) {
    case 'turn_end':
      return Object.freeze({
        status: 'completed',
        output: Object.freeze([...event.output]),
        usage: usageFromTurn(event.usage),
      });
    case 'turn_cancelled':
      return Object.freeze({
        status: 'cancelled',
        reason: event.reason,
        usage: observedUsage,
      });
    case 'error':
      return failedOutcome(event.code ?? 'turn_failed', event.error, event.recoverable, observedUsage);
    case 'budget_exceeded':
      return Object.freeze({
        status: 'budget_exceeded',
        budget: event.budget,
        usage: usageFromTurn(event.usage),
      });
  }
}

function usageFromTurn(usage: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}): Usage {
  return Object.freeze({
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  });
}

function failedOutcome(code: string, error: unknown, retryable: boolean, usage: Usage): TurnOutcome {
  return Object.freeze({
    status: 'failed',
    error: Object.freeze({
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable,
    }),
    usage,
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : String(reason ?? fallback);
}

function addUsage(current: Usage, next: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}): Usage {
  return Object.freeze({
    prompt_tokens: current.prompt_tokens + next.promptTokens,
    completion_tokens: current.completion_tokens + next.completionTokens,
    total_tokens: current.total_tokens + next.totalTokens,
  });
}
