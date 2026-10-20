import { isTurnTerminalEvent, type TurnCancelledEvent, type TurnEvent, type TurnTerminalEvent } from '../event/turn-event.js';

/**
 * Enforces the public invariant that one turn has one and only one terminal
 * event. Late chunks or a duplicate terminal from a cancelled worker are not
 * observable after the first terminal has been accepted.
 */
export class TurnTerminalGate {
  #terminal: TurnTerminalEvent | undefined;

  accept(event: TurnEvent): boolean {
    if (this.#terminal) return false;
    if (isTurnTerminalEvent(event)) this.#terminal = event;
    return true;
  }

  get terminal(): TurnTerminalEvent | undefined {
    return this.#terminal;
  }
}

export function turnCancelledEvent(error: unknown): TurnCancelledEvent {
  const name = error instanceof Error ? error.name : '';
  const reason = error instanceof Error ? error.message : String(error);
  if (name === 'TurnSupersededError') {
    return { type: 'turn_cancelled', code: 'superseded', reason };
  }
  if (name === 'TriggerCancelledError') {
    return { type: 'turn_cancelled', code: 'cancelled', reason };
  }
  if (name === 'TriggerTimeoutError' || name === 'InboundTurnExpiredError') {
    return { type: 'turn_cancelled', code: 'timeout', reason };
  }
  if (name === 'InboundTurnQueueDisposedError' || reason === 'InboundTurnQueue disposed') {
    return { type: 'turn_cancelled', code: 'disposed', reason };
  }
  return { type: 'turn_cancelled', code: 'cancelled', reason };
}

export function isTurnCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TurnCancelledError'
    || error.name === 'TurnSupersededError'
    || error.name === 'InboundTurnCancelledError'
    || error.name === 'InboundTurnExpiredError'
    || error.name === 'TriggerTimeoutError'
    || error.name === 'TriggerCancelledError'
    || error.name === 'AbortError';
}
