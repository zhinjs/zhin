/**
 * Mini-Agent features: thinking preview, step visualization, cancel mechanism.
 */

import { isCancelIntent } from '../src/turn/cancel-intent.js';
import { TriggerCancelledError, TriggerTimeoutError } from '../src/turn/trigger-cancelled-error.js';
import { isTurnCancellation, turnCancelledEvent } from '../src/turn/turn-terminal.js';
import { createTurnEventMapperState, mapAgentEventToTurnEvents } from '../src/core/turn-event-mapper.js';

describe('cancel intent detection', () => {
  it('recognizes "取消"', () => {
    expect(isCancelIntent('取消')).toBe(true);
  });

  it('recognizes "/cancel"', () => {
    expect(isCancelIntent('/cancel')).toBe(true);
  });

  it('recognizes "cancel" case-insensitive', () => {
    expect(isCancelIntent('Cancel')).toBe(true);
    expect(isCancelIntent('CANCEL')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isCancelIntent('  取消  ')).toBe(true);
    expect(isCancelIntent(' /cancel ')).toBe(true);
  });

  it('rejects non-cancel text', () => {
    expect(isCancelIntent('hello')).toBe(false);
    expect(isCancelIntent('取消了吗')).toBe(false);
    expect(isCancelIntent('/cancel all')).toBe(false);
    expect(isCancelIntent('')).toBe(false);
  });
});

describe('TriggerCancelledError', () => {
  it('has correct name and sessionKey', () => {
    const err = new TriggerCancelledError('session:123');
    expect(err.name).toBe('TriggerCancelledError');
    expect(err.sessionKey).toBe('session:123');
    expect(err.message).toContain('session:123');
  });

  it('is recognized by isTurnCancellation', () => {
    expect(isTurnCancellation(new TriggerCancelledError('s1'))).toBe(true);
  });

  it('maps to cancelled code in turnCancelledEvent', () => {
    const event = turnCancelledEvent(new TriggerCancelledError('s1'));
    expect(event.code).toBe('cancelled');
  });
});

describe('TriggerTimeoutError', () => {
  it('has correct name, sessionKey, and timeoutMs', () => {
    const err = new TriggerTimeoutError('session:456', 30000);
    expect(err.name).toBe('TriggerTimeoutError');
    expect(err.sessionKey).toBe('session:456');
    expect(err.timeoutMs).toBe(30000);
  });

  it('is recognized by isTurnCancellation', () => {
    expect(isTurnCancellation(new TriggerTimeoutError('s1', 5000))).toBe(true);
  });

  it('maps to timeout code in turnCancelledEvent', () => {
    const event = turnCancelledEvent(new TriggerTimeoutError('s1', 5000));
    expect(event.code).toBe('timeout');
  });
});

describe('iteration_start event mapping', () => {
  it('emits iteration_start on turn_start', () => {
    const state = createTurnEventMapperState(8);
    const events = [...mapAgentEventToTurnEvents({ type: 'turn_start' } as any, state)];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'iteration_start',
      iteration: 1,
      maxIterations: 8,
    });
  });

  it('increments iteration counter across multiple turn_starts', () => {
    const state = createTurnEventMapperState(15);
    const _first = [...mapAgentEventToTurnEvents({ type: 'turn_start' } as any, state)];
    const events = [...mapAgentEventToTurnEvents({ type: 'turn_start' } as any, state)];
    expect(events[0]).toEqual({
      type: 'iteration_start',
      iteration: 2,
      maxIterations: 15,
    });
  });

  it('resets accumulated text on turn_start', () => {
    const state = createTurnEventMapperState();
    state.accumulatedText = 'some text';
    state.accumulatedThinking = 'some thinking';
    const _events = [...mapAgentEventToTurnEvents({ type: 'turn_start' } as any, state)];
    expect(state.accumulatedText).toBe('');
    expect(state.accumulatedThinking).toBe('');
  });

  it('uses default maxIterations=15', () => {
    const state = createTurnEventMapperState();
    const events = [...mapAgentEventToTurnEvents({ type: 'turn_start' } as any, state)];
    expect(events[0]).toEqual({
      type: 'iteration_start',
      iteration: 1,
      maxIterations: 15,
    });
  });
});
