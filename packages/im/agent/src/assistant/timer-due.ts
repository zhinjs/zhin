/**
 * ADR 0048 H3 PR-3 — production due-timer handler: post `timer` Mail on the
 * host Mailbox (lane `timer:<jobId>`), then run the schedule executor as that
 * Mail turn (same Gap A shape as {@link deliverTimerMailInbound} in evals).
 */
import type { HostMailbox } from '../collaboration/host-mailbox.js';
import { runInMailTurn } from '../collaboration/mail-turn-context.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import { failedScheduleResult } from '../schedule-domain/execution-result.js';
import { jobPrompt, type TimerDueHandler } from './timer-scheduler.js';
import { currentScheduleCreator, type ScheduleCreatorRoleLookup } from './job-creator.js';

export interface TimerMailDueHandlerOptions {
  readonly mailbox: () => HostMailbox;
  readonly executor: TaskExecutor;
  /**
   * The creator's current chat role (`PermissionHost.currentSenderRoles`, ADR 0056 §5): a due run
   * uses it instead of the role captured at creation.
   */
  readonly creatorRoles?: ScheduleCreatorRoleLookup;
}

export function createTimerMailDueHandler(options: TimerMailDueHandlerOptions): TimerDueHandler {
  return {
    async run(scheduled, runOptions): Promise<TaskExecutionResult> {
      const createdBy = currentScheduleCreator(scheduled.createdBy, options.creatorRoles);
      const job = createdBy === scheduled.createdBy ? scheduled : { ...scheduled, createdBy };
      const content = jobPrompt(job) || job.label || job.id;
      const ownerId = job.createdBy?.userId ?? 'schedule';
      const roles = job.createdBy?.roles ?? [];
      const isMaster = roles.includes('owner');
      // Mail trust follows the creator's role: a plain user's job runs as a group member, not trusted.
      const trust = isMaster ? 'master' : roles.includes('trusted') ? 'trusted' : 'group_member';
      const mailbox = options.mailbox();
      const admission = await mailbox.admit({
        sessionKey: `timer:${job.id}`,
        senderId: ownerId,
        text: content,
        plainText: true,
        kind: 'timer',
        timerId: job.id,
        isMaster,
        trust,
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
      const beforeCalls = admission.harness.remaining(admission.mail)?.modelCalls ?? 0;
      try {
        const signal = runOptions.signal
          ? AbortSignal.any([runOptions.signal, admission.signal])
          : admission.signal;
        const result = await runInMailTurn(
          { mailbox, mail: admission.mail, batch: admission.batch },
          async () => {
            const execResult = await options.executor.execute(job, {
              signal,
              attempt: runOptions.attempt,
            });
            const afterCalls = admission.harness.remaining(admission.mail)?.modelCalls ?? 0;
            if (afterCalls === beforeCalls) {
              await admission.harness.charge(admission.mail, { modelCalls: 1 });
            }
            return execResult;
          },
        );
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
