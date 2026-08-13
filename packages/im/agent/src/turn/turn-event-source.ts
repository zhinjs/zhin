import type { OutputElement } from '@zhin.js/ai';
import type { TurnEvent } from '../event/turn-event.js';
import { TurnTerminalGate } from './turn-terminal.js';

export type TurnEventSink = (event: TurnEvent) => void;

export interface TurnEventSourceInput {
  execute(emit: TurnEventSink): Promise<readonly OutputElement[]>;
  mapError?: (error: unknown) => TurnEvent;
}

/**
 * Converts one complete Agent worker into an exactly-once TurnEvent stream.
 * The worker remains owned until settlement even when a consumer stops after
 * observing the terminal event, so generation leases cannot be released while
 * background work is still running.
 */
export async function* streamTurnEvents(
  input: TurnEventSourceInput,
): AsyncGenerator<TurnEvent, void, undefined> {
  const queue: TurnEvent[] = [];
  const terminal = new TurnTerminalGate();
  let wake: (() => void) | undefined;
  let done = false;
  let output: readonly OutputElement[] = [];
  let failure: unknown;

  const emit: TurnEventSink = (event) => {
    if (!terminal.accept(event)) return;
    queue.push(event);
    wake?.();
  };

  const worker = input.execute(emit).then(
    (value) => { output = value; },
    (error) => { failure = error; },
  ).finally(() => {
    done = true;
    wake?.();
  });

  try {
    while (!done || queue.length > 0) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => { wake = resolve; });
      wake = undefined;
    }

    if (!terminal.terminal) {
      const fallback = failure === undefined
        ? completed(output)
        : input.mapError?.(failure) ?? failed(failure);
      if (terminal.accept(fallback)) yield fallback;
    }
  } finally {
    await worker;
  }
}

function completed(output: readonly OutputElement[]): TurnEvent {
  return {
    type: 'turn_end',
    output: [...output],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function failed(error: unknown): TurnEvent {
  return {
    type: 'error',
    error: error instanceof Error ? error : new Error(String(error)),
    recoverable: false,
  };
}
