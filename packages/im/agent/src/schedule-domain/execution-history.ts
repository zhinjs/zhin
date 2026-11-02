import type { MessageRef } from '@zhin.js/im-contract';
import type { ScheduleJob } from '../assistant/types.js';
import type { ScheduleAuditRecord } from './audit-logger.js';
import type { ScheduleActivityEvent } from './activity.js';

/** One actual trigger; automatic attempts retain this identity and captured job. */
export interface ScheduleRunContext {
  readonly runId: string;
  readonly jobId: string;
  readonly queuedAt: number;
  readonly scheduledAt?: number;
  readonly source: 'scheduled' | 'manual' | 'event' | 'preview';
  readonly job: Readonly<ScheduleJob>;
}

export interface ScheduleAttemptIdentity {
  readonly runId: string;
  readonly jobId: string;
  /** The existing executionId, also used as the turn/trace identity. */
  readonly attemptId: string;
  readonly number: number;
  readonly startedAt: number;
}

/** A presentation snapshot; never an input to retry admission. */
export interface ScheduleHistoryResult {
  readonly success: boolean;
  readonly status?: 'succeeded' | 'failed' | 'cancelled' | 'budget_partial';
  readonly output: string;
  readonly error?: string;
  readonly durationMs: number;
  readonly tokenUsage: Readonly<{ input: number; output: number }>;
  readonly replay?: Readonly<{
    disposition: 'safe' | 'committed' | 'unknown';
    operations: readonly Readonly<{ id: string; status: string; toolName?: string }>[];
  }>;
  readonly delivery?: Readonly<{
    status: 'not_requested' | 'not_sent' | 'delivered' | 'partial' | 'failed' | 'unknown';
    channel: ScheduleJob['notify']['channel'];
    messages?: readonly (MessageRef | null)[];
    message?: string;
    deliveryUnknown?: true;
  }>;
}

export type ScheduleHistoryProgress = Readonly<{
  type: 'attempt_progress';
  attemptId: string;
  runId: string;
  jobId: string;
  at: number;
  phase: 'model' | 'tool' | 'approval' | 'delivery';
  status: string;
  toolName?: string;
  toolUseId?: string;
  code?: string;
}>;
export interface ScheduleReplayDecision {
  readonly decision: 'retry' | 'stop';
  readonly reason: 'cancelled' | 'timeout' | 'attempt_budget_exhausted' | 'committed' | 'unknown' | 'not_retryable' | 'read_only' | 'not_submitted';
}

export type ScheduleHistoryEvent =
  | Readonly<{ type: 'run_queued'; run: ScheduleRunContext }>
  | Readonly<{ type: 'attempt_started'; attempt: ScheduleAttemptIdentity }>
  | ScheduleHistoryProgress
  | (Readonly<{ type: 'attempt_replay'; runId: string; jobId: string; attemptId: string }> & ScheduleReplayDecision)
  | Readonly<{ type: 'attempt_finished'; attempt: ScheduleAttemptIdentity; finishedAt: number; result: ScheduleHistoryResult }>
  | Readonly<{ type: 'run_finished'; runId: string; jobId: string; finishedAt: number; result: ScheduleHistoryResult }>;

/** Observation has its own error channel; callers must not feed failures into business retry. */
export interface ScheduleHistoryObserver {
  observe(event: ScheduleHistoryEvent): void | Promise<void>;
}

/** One generation owns history, audit and activity IO; none of these observations controls execution. */
export interface ScheduleObservationOwner extends ScheduleHistoryObserver {
  audit(input: Readonly<{ attempt: ScheduleAttemptIdentity; record: ScheduleAuditRecord }>): void;
  activity(input: Readonly<{ attempt: ScheduleAttemptIdentity; event: ScheduleActivityEvent }>): void;
  close(): void;
}
