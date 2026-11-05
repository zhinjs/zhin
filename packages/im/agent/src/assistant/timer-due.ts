/**
 * ADR 0048 H3 PR-3 — production due-timer handler: post `timer` Mail on the
 * host Mailbox (lane `timer:<jobId>`), then run the schedule executor as that
 * Mail turn (same Gap A shape as {@link deliverTimerMailInbound} in evals).
 */
import type { HostMailbox } from '../collaboration/host-mailbox.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import { failedScheduleResult } from '../schedule-domain/execution-result.js';
import { jobPrompt, type TimerDueHandler } from './timer-scheduler.js';

export interface TimerMailDueHandlerOptions {
  readonly mailbox: () => HostMailbox;
  readonly executor: TaskExecutor;
}

export function createTimerMailDueHandler(options: TimerMailDueHandlerOptions): TimerDueHandler {
  return {
    async run(job, runOptions): Promise<TaskExecutionResult> {
      const content = jobPrompt(job) || job.label || job.id;
      const ownerId = job.createdBy?.userId ?? 'schedule';
      const roles = job.createdBy?.roles ?? [];
      const isMaster = roles.includes('master');
      const mailbox = options.mailbox();
      const admission = await mailbox.admit({
        sessionKey: `timer:${job.id}`,
        senderId: ownerId,
        text: content,
        plainText: true,
        kind: 'timer',
        timerId: job.id,
        isMaster,
        trust: isMaster ? 'master' : 'trusted',
        ...(job.createdBy?.name ? { senderName: job.createdBy.name } : {}),
      });
      if (admission.kind !== 'run') {
        const reason = admission.kind === 'rejected' ? admission.reason : admission.kind;
        return failedScheduleResult({
          job,
          cause: new Error(`timer mail not admitted: ${reason}`),
          attempt: runOptions.attempt,
          runId: runOptions.attempt?.identity.runId ?? job.id,
          startedAt: Date.now(),
          cancelled: admission.kind === 'rejected' && admission.reason === 'stopped',
        });
      }
      let status: 'completed' | 'failed' | 'cancelled' = 'failed';
      try {
        const signal = runOptions.signal
          ? AbortSignal.any([runOptions.signal, admission.signal])
          : admission.signal;
        const result = await options.executor.execute(job, {
          signal,
          attempt: runOptions.attempt,
        });
        status = result.success ? 'completed' : signal.aborted ? 'cancelled' : 'failed';
        return result;
      } catch (cause) {
        status = admission.signal.aborted ? 'cancelled' : 'failed';
        throw cause;
      } finally {
        admission.release(status);
      }
    },
  };
}
