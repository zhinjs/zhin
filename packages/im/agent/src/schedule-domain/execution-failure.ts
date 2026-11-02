import type { TaskExecutionResult } from '../task-executor.js';
import type { ReplayEvidence } from './replay-evidence.js';

/** Preserve execution facts across the queue's failure/retry boundary. */
export class ScheduleAttemptFailure extends Error {
  readonly result?: TaskExecutionResult;
  readonly replay: ReplayEvidence;
  constructor({ cause, result, replay }: {
    readonly cause: unknown;
    readonly result?: TaskExecutionResult;
    readonly replay: ReplayEvidence;
  }) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ScheduleAttemptFailure';
    this.result = result;
    this.replay = replay;
  }
}
