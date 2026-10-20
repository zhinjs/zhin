/**
 * Detached tasks (#731, roadmap P5 M5.1–M5.3): background work with its own
 * taskId, a persisted state machine, a frozen permission snapshot, step
 * checkpoints and idempotency keys for side-effecting tool calls.
 */
import type { AgentStepCheckpoint } from '@zhin.js/ai/agent-step-checkpoint';
import type { ToolInvocationPolicy } from '@zhin.js/tool';

export const DetachedTaskStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  PAUSED: 'paused',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type DetachedTaskStatusName = (typeof DetachedTaskStatus)[keyof typeof DetachedTaskStatus];

export const TERMINAL_DETACHED_TASK_STATUSES: ReadonlySet<DetachedTaskStatusName> = new Set(['done', 'failed', 'cancelled']);

/** Allowed transitions. Terminal states never move again. */
export const DETACHED_TASK_TRANSITIONS: Readonly<Record<DetachedTaskStatusName, readonly DetachedTaskStatusName[]>> = Object.freeze({
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'paused', 'done', 'failed', 'cancelled', 'queued'],
  waiting_approval: ['queued', 'running', 'failed', 'cancelled'],
  paused: ['queued', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
});

export class DetachedTaskTransitionError extends Error {
  constructor(readonly taskId: string, readonly from: DetachedTaskStatusName, readonly to: DetachedTaskStatusName) {
    super(`Detached task ${taskId}: illegal transition ${from} -> ${to}`);
    this.name = 'DetachedTaskTransitionError';
  }
}

export function canTransitionDetachedTask(from: DetachedTaskStatusName, to: DetachedTaskStatusName): boolean {
  return DETACHED_TASK_TRANSITIONS[from].includes(to);
}

/** Permission snapshot frozen when the task is created; resume never widens it. */
export type DetachedTaskPolicy = Readonly<Pick<ToolInvocationPolicy, 'shell' | 'filesystem'>>;

/** Where progress/results go, and where approval requests go. Opaque to the runner. */
export interface DetachedTaskChannel {
  readonly adapter?: string;
  readonly endpointId?: string;
  readonly sceneId?: string;
  readonly sceneType?: string;
}

/** A completed tool call recorded after each step (M5.2). */
export interface DetachedTaskStep extends AgentStepCheckpoint {
  readonly index: number;
  readonly tool: string;
  readonly result: unknown;
  readonly idempotencyKey?: string;
}

export interface DetachedTaskSteering {
  /** Number of steps completed when the steering was applied. */
  readonly atStep: number;
  readonly text: string;
  readonly at: number;
}

export type DetachedTaskEffectStatus = 'executing' | 'committed' | 'outcome_unknown';

/** Effect ledger entry for a side-effecting call, keyed by its idempotency key. */
export interface DetachedTaskEffect {
  readonly key: string;
  readonly tool: string;
  readonly status: DetachedTaskEffectStatus;
  readonly result?: unknown;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export interface DetachedTaskRecord {
  readonly version: 1;
  readonly taskId: string;
  /** Executor kind, used to pick the executor again after a restart. */
  readonly kind: string;
  readonly goal: string;
  readonly sessionId?: string;
  /** Principal that created the task; only they (or a master) may stop or redirect it. */
  readonly createdBy?: string;
  /** Steering messages queued by the user, applied at the next step boundary (#732). */
  readonly pendingSteering?: readonly string[];
  /** Steering already applied, keyed by the step boundary it was applied at (replayed on resume). */
  readonly steeringLog?: readonly DetachedTaskSteering[];
  readonly status: DetachedTaskStatusName;
  readonly policy: DetachedTaskPolicy;
  readonly delivery?: DetachedTaskChannel;
  readonly approval?: DetachedTaskChannel;
  readonly steps: readonly DetachedTaskStep[];
  readonly effects: Readonly<Record<string, DetachedTaskEffect>>;
  /** Free-form executor state saved with each checkpoint (e.g. a cursor). */
  readonly state?: unknown;
  readonly summary?: string;
  readonly error?: string;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Conservative defaults. Background tasks are opt-in: nothing creates one
 * unless a caller does so explicitly.
 */
export interface DetachedTaskConfig {
  /** Minimum gap between progress pushes (ms). Default 60 000. */
  readonly progressIntervalMs?: number;
  /** Max progress pushes per task run. Default 10. */
  readonly maxProgressUpdates?: number;
  /** Max steps (tool calls) before the task fails as runaway. Default 50. */
  readonly maxSteps?: number;
  /** Max automatic resumes after a restart before failing. Default 3. */
  readonly maxResumeAttempts?: number;
  /** How long cancel waits for the running executor to settle (ms). Default 5 000. */
  readonly cancelGraceMs?: number;
}

export const DEFAULT_DETACHED_TASK_CONFIG: Readonly<Required<DetachedTaskConfig>> = Object.freeze({
  progressIntervalMs: 60_000,
  maxProgressUpdates: 10,
  maxSteps: 50,
  maxResumeAttempts: 3,
  cancelGraceMs: 5_000,
});
