import { WorkroomSequenceConflictError, type WorkroomJournal } from './journal.js';
import {
  decideWorkroomSchedule,
  type WorkroomScheduleDecision,
} from './workroom-scheduler.js';
import { deepFreezeWorkroomValue as deepFreeze } from './canonical-value.js';
import type { WorkroomKernel } from './workroom-kernel.js';

export type WorkroomSchedulerKernelCommitReceipt = Readonly<{
  status: 'committed' | 'duplicate';
  decisionId: string;
  sequence: number;
}>;

/**
 * Role-scoped Kernel CAS seam. Implementations may validate and append the
 * typed Scheduler event; the Scheduler Application never receives a raw
 * Journal writer and cannot directly mutate Run/Task/Assignment state.
 */
export interface WorkroomSchedulerKernelCommandPort {
  commit(
    decision: WorkroomScheduleDecision,
  ): Promise<WorkroomSchedulerKernelCommitReceipt>;
}

export function createWorkroomSchedulerKernelCommandPort(
  kernel: Pick<WorkroomKernel, 'commitSchedulerDecision'>,
): WorkroomSchedulerKernelCommandPort {
  return Object.freeze({
    commit: (decision: WorkroomScheduleDecision) => kernel.commitSchedulerDecision(decision),
  });
}

export type WorkroomSchedulerApplicationResult =
  | Readonly<{ status: 'idle'; runId: string }>
  | Readonly<{
      status: 'committed' | 'duplicate';
      runId: string;
      taskKey: string;
      decisionType: WorkroomScheduleDecision['type'];
      expectedSequence: number;
      committedSequence: number;
      decisionId: string;
    }>;

export interface WorkroomSchedulerApplicationOptions {
  readonly journal: Pick<WorkroomJournal, 'listRunIds' | 'read'>;
  readonly commands: WorkroomSchedulerKernelCommandPort;
  readonly maxCasRetries?: number;
}

/** Stateless, restart-safe Journal consumer for deterministic Task selection. */
export class WorkroomSchedulerApplication {
  readonly #maxCasRetries: number;

  constructor(readonly options: WorkroomSchedulerApplicationOptions) {
    this.#maxCasRetries = nonNegativeInteger(options.maxCasRetries ?? 3, 'maxCasRetries');
  }

  async runOnce(runId: string): Promise<WorkroomSchedulerApplicationResult> {
    text(runId, 'Workroom Scheduler runId');
    for (let attempt = 0; attempt <= this.#maxCasRetries; attempt += 1) {
      const decision = decideWorkroomSchedule(await this.options.journal.read(runId));
      if (!decision) return deepFreeze({ status: 'idle', runId });
      try {
        const receipt = normalizeReceipt(await this.options.commands.commit(decision), decision);
        return deepFreeze({
          status: receipt.status,
          runId,
          taskKey: decision.type === 'dispatch_task' ? decision.taskKey : decision.reservedTaskKey,
          decisionType: decision.type,
          expectedSequence: decision.expectedSequence,
          committedSequence: receipt.sequence,
          decisionId: decision.decisionId,
        });
      } catch (error) {
        if (!(error instanceof WorkroomSequenceConflictError) || attempt === this.#maxCasRetries) {
          throw error;
        }
      }
    }
    throw new Error('Workroom Scheduler CAS retry loop exhausted');
  }

  async recover(): Promise<readonly WorkroomSchedulerApplicationResult[]> {
    const results: WorkroomSchedulerApplicationResult[] = [];
    for (const runId of [...await this.options.journal.listRunIds()].sort()) {
      results.push(await this.runOnce(runId));
    }
    return deepFreeze(results);
  }
}

function normalizeReceipt(
  value: WorkroomSchedulerKernelCommitReceipt,
  decision: WorkroomScheduleDecision,
): WorkroomSchedulerKernelCommitReceipt {
  if (!value || !['committed', 'duplicate'].includes(value.status)
    || value.decisionId !== decision.decisionId
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < decision.expectedSequence + 1) {
    throw new Error('Workroom Scheduler Kernel command returned an invalid receipt');
  }
  return deepFreeze({ ...value });
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Workroom Scheduler ${label} must be a non-negative safe integer`);
  }
  return Number(value);
}
