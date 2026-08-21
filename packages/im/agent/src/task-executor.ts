/** Delivery boundary for the independent schedule execution domain. */
import { getLogger } from '@zhin.js/logger';
import { createNotificationRouter, type NotificationRouter } from './assistant/notification-router.js';
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

const logger = getLogger('task-executor');
const sceneLocks = new KeyedMutex();

export interface TaskExecutionResult extends ScheduleExecutionResult {
  responseText: string;
  executionPlan?: ScheduleJobExecutionPlan;
}

export interface TaskExecutorDeps {
  turn?: ScheduleTurnPort;
  config?: Required<ZhinAgentConfig>;
  resolveAdapter: (platform: string) => { sendMessage: (opts: import('@zhin.js/core').SendOptions) => Promise<string> } | undefined;
  router?: NotificationRouter;
  activity?: ScheduleActivityPort;
  defaultNotify?: import('./assistant/types.js').JobNotify;
  domain?: ScheduleExecutionDomain;
  dataDir?: string;
}

export interface TaskExecutionOptions {
  previewSource?: ScheduleInvocationContext;
  signal?: AbortSignal;
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
  const router = deps.router ?? createNotificationRouter({ resolveAdapter: deps.resolveAdapter });
  const domain = deps.domain ?? new ScheduleExecutionDomainImpl({
    turn: deps.turn ?? missingScheduleTurnPort(),
    config: deps.config ?? DEFAULT_CONFIG,
    auditLogger: new JsonlScheduleAuditLogger(deps.dataDir),
  });

  async function execute(job: ScheduleJob, options: TaskExecutionOptions = {}): Promise<TaskExecutionResult> {
    options.signal?.throwIfAborted();
    const previewSource = options.previewSource;
    const effectiveNotify = router.resolveEffectiveNotify(job.notify, deps.defaultNotify);
    const event = async (phase: ScheduleActivityEvent['phase']) => {
      if (!job.activityFeedback) return;
      await deps.activity?.publish({ phase, job, previewSource, notify: effectiveNotify });
    };
    const lockKey = previewSource
      ? `preview:${previewSource.sessionKey}`
      : scheduleLockKey(job, effectiveNotify);

    await event('start');
    let result: ScheduleExecutionResult;
    try {
      result = await sceneLocks.run(lockKey, () => domain.execute(job, {
        preview: Boolean(previewSource),
        signal: options.signal,
      }), options.signal);
      options.signal?.throwIfAborted();
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

    if (!result.success) {
      await event('error');
      logger.error(`[TaskExecutor] 执行失败: ${result.error ?? 'unknown error'}`);
    } else if (previewSource) {
      await event('finish');
    } else {
      if (result.output) {
        try {
          await deliverScheduleToAdapter({
            notify: effectiveNotify,
            content: result.output,
            router,
            source: 'scheduled',
          });
        } catch (error) {
          await event('error');
          throw error;
        }
      }
      await event('finish');
    }

    return { ...result, responseText: result.output, executionPlan };
  }

  async function preview(
    prompt: string,
    source: ScheduleInvocationContext,
    options: { activityFeedback?: boolean } = {},
  ): Promise<TaskExecutionResult> {
    const now = Date.now();
    const job: ScheduleJob = {
      id: `preview-${now}`,
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

  return { execute, preview, resolveAdapter: deps.resolveAdapter };
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

export async function drainTaskExecutorLocks(timeoutMs: number): Promise<void> {
  await sceneLocks.drain(timeoutMs);
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;
