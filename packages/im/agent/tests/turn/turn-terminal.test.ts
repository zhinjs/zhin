import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { TurnTerminalGate, isTurnCancellation, turnCancelledEvent } from '../../src/turn/turn-terminal.js';

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('TurnTerminalGate', () => {
  it('exposes exactly one terminal event when a superseded turn finishes late', () => {
    const gate = new TurnTerminalGate();
    const events: TurnEvent[] = [
      { type: 'chunk', text: 'partial', accumulated: 'partial' },
      turnCancelledEvent(namedError('TurnSupersededError', 'replaced by a newer turn')),
      { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ];

    const accepted = events.filter((event) => gate.accept(event));
    expect(accepted.map((event) => event.type)).toEqual(['chunk', 'turn_cancelled']);
    expect(gate.terminal).toMatchObject({ type: 'turn_cancelled', code: 'superseded' });
  });

  it('classifies deadline cancellation as a cancelled terminal, not a failure', () => {
    const timeout = namedError('TriggerTimeoutError', 'deadline elapsed');
    expect(isTurnCancellation(timeout)).toBe(true);
    expect(turnCancelledEvent(timeout)).toEqual({
      type: 'turn_cancelled',
      code: 'timeout',
      reason: 'deadline elapsed',
    });
  });
});
