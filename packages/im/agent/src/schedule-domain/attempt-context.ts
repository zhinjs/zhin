import { randomUUID } from 'node:crypto';
import type { ScheduleAttemptIdentity, ScheduleRunContext } from './execution-history.js';
import { ScheduleHistoryReporter } from './history-observer.js';
import { AttemptReplayEvidence } from './replay-evidence.js';

/** Fixed identity, actual-call evidence and independent observation for one attempt. */
export interface ScheduleAttemptContext {
  readonly identity: ScheduleAttemptIdentity;
  readonly evidence: AttemptReplayEvidence;
  readonly history: ScheduleHistoryReporter;
}

export function createScheduleAttempt({ run, number, history }: {
  readonly run: ScheduleRunContext;
  readonly number: number;
  readonly history: ScheduleHistoryReporter;
}): ScheduleAttemptContext {
  return { identity: Object.freeze({ runId: run.runId, jobId: run.jobId, attemptId: randomUUID(), number, startedAt: Date.now() }),
    evidence: new AttemptReplayEvidence(), history };
}
