/**
 * Virtual clock for evals. Timers never fire on their own; they only run when
 * the scripted model advances time (the `hang` fault step), so timeout cases
 * are deterministic and never wait in real time.
 */
import type { ProviderTimers } from '@zhin.js/ai';

export interface EvalClock extends ProviderTimers {
  /** Virtual milliseconds elapsed. */
  now(): number;
  /** Fire the earliest pending timer, moving virtual time to it. Returns false when none is pending. */
  runNext(): boolean;
}

export function createFakeClock(): EvalClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
    runNext() {
      let earliest: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of timers) if (!earliest || entry[1].at < earliest[1].at) earliest = entry;
      if (!earliest) return false;
      timers.delete(earliest[0]);
      now = Math.max(now, earliest[1].at);
      earliest[1].fn();
      return true;
    },
  };
}
