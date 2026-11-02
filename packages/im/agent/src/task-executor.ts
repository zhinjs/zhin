/** Delivery boundary for the independent schedule execution domain. */
import { resolveLocale } from '@zhin.js/plugin-runtime';
import { getLogger } from '@zhin.js/logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EndpointDeliveryError, type DeliveryReceipt, type MessageRef } from '@zhin.js/im-contract';
import type { NotificationRouter } from './assistant/notification-router.js';
import type { ScheduleJob, ScheduleJobExecutionPlan } from './assistant/types.js';
import { scheduleJobCreatorFromPrincipal } from './assistant/job-creator.js';
import type { ScheduleInvocationContext } from './assistant/schedule-job-service.js';
import { deliverScheduleToAdapter } from './assistant/deliver-schedule-to-adapter.js';
import { KeyedMutex } from './utils/keyed-mutex.js';
import {
  ScheduleExecutionDomainImpl,
  type ScheduleExecutionDomain,
  type ScheduleExecutionResult,
  type ScheduleTurnPort,
} from './schedule-domain/execution-domain.js';
import { JsonlScheduleAuditLogger } from './schedule-domain/audit-logger.js';
import type { ZhinAgentConfig } from './config/zhin-agent-config.js';
import { DEFAULT_CONFIG } from './config/zhin-agent-defaults.js';
import type { ScheduleHistoryObserver, ScheduleRunContext } from './schedule-domain/execution-history.js';
import { ScheduleHistoryReporter } from './schedule-domain/history-observer.js';
import { createScheduleAttempt, type ScheduleAttemptContext } from './schedule-domain/attempt-context.js';
import { ScheduleAttemptFailure } from './schedule-domain/execution-failure.js';
import { failedScheduleResult } from './schedule-domain/execution-result.js';

const logger = getLogger('task-executor');

export interface TaskExecutionResult extends ScheduleExecutionResult {
  responseText: string;
  executionPlan?: ScheduleJobExecutionPlan;
  delivery?: TaskDeliveryOutcome;
}

/** Business completion is independent of the final notification's transport evidence. */
export interface TaskDeliveryOutcome {
  readonly status: 'not_requested' | 'not_sent' | 'delivered' | 'partial' | 'failed' | 'unknown';
  readonly channel: ScheduleJob['notify']['channel'];
  readonly message?: string;
  readonly messages?: readonly (MessageRef | null)[];
  readonly deliveryUnknown?: true;
}

export interface TaskExecutorDeps {
  turn?: ScheduleTurnPort;
  config?: Required<ZhinAgentConfig>;
  router: NotificationRouter;
  activity?: ScheduleActivityPort;
  defaultNotify?: import('./assistant/types.js').JobNotify;
  domain?: ScheduleExecutionDomain;
  dataDir?: string;
  history?: ScheduleHistoryObserver;
}

export interface TaskExecutionOptions {
  previewSource?: ScheduleInvocationContext;
  signal?: AbortSignal;
  attempt?: ScheduleAttemptContext;
}

export interface ScheduleActivityEvent {
  readonly phase: 'start' | 'finish' | 'error';
  readonly job: ScheduleJob;
  readonly previewSource?: ScheduleInvocationContext;
  readonly notify: import('./assistant/types.js').JobNotify;
}

export interface ScheduleActivityPort {
  publish(event: ScheduleActivityEvent): void | Promise<void>;
}

export function createTaskExecutor(deps: TaskExecutorDeps) {
  const sceneLocks = new KeyedMutex();
  const executionContext = new AsyncLocalStorage<boolean>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const { router } = deps;
  const domain = deps.domain ?? new ScheduleExecutionDomainImpl({
    turn: deps.turn ?? missingScheduleTurnPort(),
    config: deps.config ?? DEFAULT_CONFIG,
    auditLogger: new JsonlScheduleAuditLogger(deps.dataDir),
  });

  async function execute(job: ScheduleJob, options: TaskExecutionOptions = {}): Promise<TaskExecutionResult> {
    if (disposed) throw new Error('TaskExecutor has been disposed');
    options.signal?.throwIfAborted();
    const previewSource = options.previewSource;
    const effectiveNotify = router.resolveEffectiveNotify(job.notify, deps.defaultNotify);
    const run: ScheduleRunContext | undefined = options.attempt ? undefined : {
      runId: randomUUID(), jobId: job.id, queuedAt: Date.now(),
      source: previewSource ? 'preview' : 'scheduled',
      job: structuredClone(job),
    };
    const attempt = options.attempt ?? createScheduleAttempt({ run: run!, number: 1, history: new ScheduleHistoryReporter(deps.history) });
    if (run) {
      void attempt.history.observe({ type: 'run_queued', run });
      void attempt.history.observe({ type: 'attempt_started', attempt: attempt.identity });
    }
    const event = async (phase: ScheduleActivityEvent['phase']) => {
      if (!job.activityFeedback) return;
      try { await deps.activity?.publish({ phase, job, previewSource, notify: effectiveNotify }); }
      catch { logger.warn('Schedule activity recording failed'); }
    };
    const lockKey = previewSource
      ? `preview:${previewSource.sessionKey}`
      : scheduleLockKey(job, effectiveNotify);

    const execution = sceneLocks.run(lockKey, () => executionContext.run(true, async () => {
      // Activity belongs to admitted execution, not to time spent waiting for
      // the per-scene mutex. Keeping its terminal inside the same critical
      // section prevents a prior run from clearing a later run's indicator.
      await event('start');
      let result: ScheduleExecutionResult;
      try {
        result = await domain.execute(job, {
          preview: Boolean(previewSource),
          signal: options.signal,
          attempt,
        });
        if (options.signal?.aborted) {
          throw new ScheduleAttemptFailure({ cause: options.signal.reason ?? new Error('Schedule execution cancelled'),
            replay: attempt.evidence.snapshot(), result: { ...result, responseText: result.output,
              success: false, status: 'cancelled', error: options.signal.reason instanceof Error
                ? options.signal.reason.message : String(options.signal.reason ?? 'Schedule execution cancelled'),
              replay: result.replay ?? { disposition: 'unknown', operations: [] } } });
        }
      } catch (error) {
        await event('error');
        throw error;
      }
      const executionPlan = previewSource
        ? {
            prompt: job.action.prompt,
            tools: result.audit.toolsResolved.length ? result.audit.toolsResolved : undefined,
            skills: result.audit.skillsResolved?.length ? result.audit.skillsResolved : undefined,
            previewSample: result.output || undefined,
            previewedAt: Date.now(),
            confirmed: false,
          }
        : job.executionPlan;
      let delivery: TaskDeliveryOutcome = { status: 'not_requested', channel: effectiveNotify.channel };

      if (!result.success) {
        await event('error');
        logger.error(`[TaskExecutor] 执行失败: ${result.error ?? 'unknown error'}`);
      } else if (previewSource) {
        await event('finish');
      } else {
        if (result.output) {
          void attempt.history.observe({ type: 'attempt_progress', ...attempt.identity, at: Date.now(), phase: 'delivery', status: 'started' });
          try {
            const sent = await deliverScheduleToAdapter({
              notify: effectiveNotify,
              content: result.output,
              router,
              source: 'scheduled',
              locale: resolveLocale(job.locale),
            });
            delivery = sent.receipt ? deliveryFromReceipt(sent.receipt, sent.channel)
              : { status: effectiveNotify.channel === 'silent' || effectiveNotify.channel === 'log'
                ? 'not_requested' : sent.delivered ? sent.channel === 'ha' ? 'unknown' : 'delivered' : 'not_sent', channel: sent.channel };
          } catch (error) {
            delivery = error instanceof EndpointDeliveryError && error.receipt ? deliveryFromReceipt(error.receipt, effectiveNotify.channel)
              : { status: error instanceof EndpointDeliveryError
              ? error.parts?.length ? 'partial' : error.disposition === 'not_sent' ? 'not_sent'
                : error.disposition === 'rejected' ? 'failed' : 'unknown' : 'unknown',
              channel: effectiveNotify.channel, message: error instanceof Error ? error.message : String(error),
              ...(error instanceof EndpointDeliveryError && error.parts?.length ? { messages: error.parts.map(() => null) } : {}),
              ...(error instanceof EndpointDeliveryError && error.disposition === 'unknown' ? { deliveryUnknown: true as const } : {}) };
          }
          void attempt.history.observe({ type: 'attempt_progress', ...attempt.identity, at: Date.now(), phase: 'delivery', status: delivery.status });
        }
        await event('finish');
      }

      const observedReplay = attempt.evidence.snapshot();
      return { ...result, responseText: result.output, executionPlan, delivery,
        replay: result.replay ?? (observedReplay.operations.length ? observedReplay : { disposition: 'unknown' as const, operations: [] }) };
    }), options.signal);
    try {
      const result = await execution;
      if (run) {
        void attempt.history.observe({ type: 'attempt_finished', attempt: attempt.identity, finishedAt: Date.now(), result });
        attempt.history.observe({ type: 'run_finished', runId: run.runId, jobId: job.id, finishedAt: Date.now(), result });
      }
      return result;
    } catch (cause) {
      const result = cause instanceof ScheduleAttemptFailure && cause.result ? cause.result
        : { ...failedScheduleResult({ job, cause, attempt, runId: attempt.identity.runId,
          startedAt: attempt.identity.startedAt, cancelled: options.signal?.aborted }),
          replay: cause instanceof ScheduleAttemptFailure ? cause.replay : { disposition: 'unknown' as const, operations: [] } };
      if (run) {
        void attempt.history.observe({ type: 'attempt_finished', attempt: attempt.identity, finishedAt: Date.now(), result });
        attempt.history.observe({ type: 'run_finished', runId: run.runId, jobId: job.id, finishedAt: Date.now(), result });
      }
      throw new ScheduleAttemptFailure({ cause, result, replay: result.replay ?? { disposition: 'unknown', operations: [] } });
    }
  }

  async function preview(
    prompt: string,
    source: ScheduleInvocationContext,
    options: { activityFeedback?: boolean } = {},
  ): Promise<TaskExecutionResult> {
    const now = Date.now();
    const job: ScheduleJob = {
      id: `preview-${now}`,
      locale: resolveLocale(source.locale),
      enabled: true,
      schedule: { kind: 'at', atMs: now },
      action: { kind: 'agent', prompt },
      notify: { channel: 'silent' },
      createdAt: now,
      updatedAt: now,
      state: {},
      source: 'manual',
      createdBy: scheduleJobCreatorFromPrincipal(source.principal),
      activityFeedback: options.activityFeedback,
    };
    return execute(job, { previewSource: source });
  }

  function dispose(): Promise<void> {
    if (executionContext.getStore()) {
      return Promise.reject(new Error(
        'TaskExecutor cannot dispose from inside its own execution callback; dispose it from the owning lifecycle',
      ));
    }
    if (disposal) return disposal;
    disposed = true;
    disposal = sceneLocks.drain();
    return disposal;
  }

  return { execute, preview, dispose };
}

function missingScheduleTurnPort(): ScheduleTurnPort {
  return Object.freeze({
    execute: async () => {
      throw new Error('TaskExecutor requires a ScheduleTurnPort when no execution domain is supplied');
    },
  });
}

function scheduleLockKey(job: ScheduleJob, notify: import('./assistant/types.js').JobNotify): string {
  if (notify.channel !== 'im') return `schedule:${job.id}`;
  const scene = notify.target.scene;
  return `im:${scene.platform}:${scene.endpointKey}:${scene.kind}:${scene.sceneId}`;
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;

function deliveryFromReceipt(receipt: DeliveryReceipt, channel: TaskDeliveryOutcome['channel']): TaskDeliveryOutcome {
  const messages = receipt.parts?.map(part => part.message ?? null) ?? (receipt.message ? [receipt.message] : []);
  return {
    status: receipt.status === 'sent' ? 'delivered' : messages.length ? 'partial'
      : receipt.failure?.deliveryUnknown ? 'unknown' : receipt.status === 'failed' || receipt.status === 'rejected' ? 'failed' : 'not_sent',
    channel, ...(messages.length ? { messages } : {}),
    ...(receipt.failure?.message ? { message: receipt.failure.message } : {}),
    ...(receipt.failure?.deliveryUnknown ? { deliveryUnknown: true } : {}),
  };
}
