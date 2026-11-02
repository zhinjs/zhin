import { createScheduleAuditRecord } from './audit-logger.js';
import type { ScheduleJob } from '../assistant/types.js';
import type { TaskExecutionResult } from '../task-executor.js';
import type { ScheduleAttemptContext } from './attempt-context.js';

/** Only used when execution could not produce its own structured result. */
export function failedScheduleResult({ job, cause, attempt, runId, startedAt, cancelled = false }: {
  readonly job: ScheduleJob;
  readonly cause: unknown;
  readonly attempt?: ScheduleAttemptContext;
  readonly runId: string;
  readonly startedAt: number;
  readonly cancelled?: boolean;
}): TaskExecutionResult {
  const error = cause instanceof Error ? cause.message : String(cause);
  const toolsUsed = attempt?.evidence.snapshot().operations.map(operation => operation.toolName) ?? [];
  const durationMs = Date.now() - startedAt;
  return { success: false, status: cancelled ? 'cancelled' : 'failed', error, responseText: '', output: '', durationMs,
    toolsUsed, tokenUsage: { input: 0, output: 0 }, replay: attempt?.evidence.snapshot(),
    audit: createScheduleAuditRecord({ jobId: job.id, executionId: attempt?.identity.attemptId ?? `queued-${runId}`,
      timestamp: startedAt, createdBy: job.createdBy, prompt: job.action.prompt, toolsResolved: [],
      toolsResolvedBy: job.executionPlan ? 'execution-plan' : 'affinity', skillsResolved: [], missingTools: [], missingSkills: [],
      toolsUsed, tokenUsage: { input: 0, output: 0 }, durationMs, securityDenials: [], success: false,
      outputLength: 0, outputStripped: [], error }),
  };
}
