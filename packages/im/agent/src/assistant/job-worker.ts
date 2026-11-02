/**
 * JobWorker — 执行 Schedule Agent 任务（owned queue：重试 / 并发 / 死信）
 */
import { getLogger } from '@zhin.js/logger';
import { randomUUID } from 'node:crypto';
import { ScheduleExecutionQueue, ScheduleQueueCancellation } from '../schedule-domain/schedule-execution-queue.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import { type AssistantQueueConfig, resolveAssistantQueueConfig } from './config.js';
import type { ScheduleJob } from './types.js';
import { createScheduleAttempt, type ScheduleAttemptContext } from '../schedule-domain/attempt-context.js';
import { ScheduleAttemptFailure } from '../schedule-domain/execution-failure.js';
import { failedScheduleResult } from '../schedule-domain/execution-result.js';
import { ScheduleHistoryReporter } from '../schedule-domain/history-observer.js';
import type { ScheduleHistoryObserver, ScheduleRunContext, ScheduleObservationOwner } from '../schedule-domain/execution-history.js';
const logger = getLogger('assistant-job-worker');

export interface JobWorkerOptions {
  executor: TaskExecutor;
  queue?: AssistantQueueConfig;
  history?: ScheduleHistoryObserver;
  observations?: ScheduleObservationOwner;
}

export class JobWorker {
  private executor: TaskExecutor;
  private queueCfg: ReturnType<typeof resolveAssistantQueueConfig>;
  private readonly queue: ScheduleExecutionQueue;
  readonly #history?: ScheduleHistoryObserver;
  readonly #observations?: ScheduleObservationOwner;

  constructor(options: JobWorkerOptions) {
    this.executor = options.executor;
    this.#history = options.history;
    this.#observations = options.observations ?? options.executor.observations;
    this.queueCfg = resolveAssistantQueueConfig(options.queue);
    this.queue = new ScheduleExecutionQueue({
      maxConcurrency: this.queueCfg.maxConcurrency,
      defaultMaxRetries: this.queueCfg.maxRetries,
      defaultTimeoutMs: this.queueCfg.defaultTimeoutMs,
    });
  }

  async run(
    job: ScheduleJob,
    options: Readonly<{ source?: ScheduleRunContext['source']; scheduledAt?: number }> = {},
  ): Promise<TaskExecutionResult> {
    job = structuredClone(job);
    const label = job.label || job.id;
    const run: ScheduleRunContext = { runId: randomUUID(), jobId: job.id, queuedAt: Date.now(),
      source: options.source ?? 'scheduled', job,
      ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }) };
    const history = new ScheduleHistoryReporter(this.#history, this.#observations);
    void history.observe({ type: 'run_queued', run });
    const finish = (result: TaskExecutionResult) => {
      history.observe({ type: 'run_finished', runId: run.runId, jobId: job.id, finishedAt: Date.now(), result });
      return result;
    };
    let number = 0;
    let attempt: ScheduleAttemptContext | undefined;
    let lastResult: TaskExecutionResult | undefined;
    try {
      const result = await this.queue.enqueueAndWait({
        name: label,
        maxRetries: this.queueCfg.maxRetries,
        timeoutMs: this.queueCfg.defaultTimeoutMs,
        canRetry: error => error instanceof ScheduleAttemptFailure && error.replay.disposition === 'safe',
        onRetryDecision: decision => {
          if (!attempt) return;
          const replay = lastResult?.replay ?? attempt.evidence.snapshot();
          void history.observe({ type: 'attempt_replay', runId: run.runId, jobId: job.id,
            attemptId: attempt.identity.attemptId, decision: decision.retry ? 'retry' : 'stop',
            reason: decision.retry ? replay.reason ?? 'not_submitted'
              : decision.reason === 'not_retryable' ? replay.disposition === 'safe' ? 'not_retryable' : replay.disposition
                : decision.reason });
        },
        execute: async signal => {
          attempt = createScheduleAttempt({ run, number: ++number, history });
          void history.observe({ type: 'attempt_started', attempt: attempt.identity });
          let result: TaskExecutionResult;
          let failure: unknown;
          try {
            result = await this.executor.execute(job, { signal, attempt });
          } catch (cause) {
            failure = cause;
            result = cause instanceof ScheduleAttemptFailure && cause.result ? cause.result
              : { ...failedScheduleResult({ job, cause, attempt, runId: run.runId,
                startedAt: attempt.identity.startedAt, cancelled: signal.aborted }),
                replay: cause instanceof ScheduleAttemptFailure ? cause.replay : { disposition: 'unknown', operations: [] } };
          }
          lastResult = result;
          void history.observe({ type: 'attempt_finished', attempt: attempt.identity, finishedAt: Date.now(), result });
          if (!result.success) throw new ScheduleAttemptFailure({ cause: failure ?? new Error(result.error || 'job failed'),
            result, replay: result.replay ?? { disposition: 'unknown', operations: [] } });
          return result;
        },
      });
      return finish(result);
    } catch (e: unknown) {
      const error = (e as Error)?.message || String(e);
      logger.warn(`Job ${label} dead-letter: ${error}`);
      const result = e instanceof ScheduleAttemptFailure && e.result ? e.result : lastResult
        ?? failedScheduleResult({ job, cause: e, attempt, runId: run.runId, startedAt: run.queuedAt,
          cancelled: e instanceof ScheduleQueueCancellation });
      return finish(result);
    }
  }

  async stop(): Promise<void> {
    await this.queue.dispose();
  }
}
