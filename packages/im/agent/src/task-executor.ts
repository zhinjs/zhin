/** Delivery boundary for the independent schedule execution domain. */
import { type Message, createSyntheticMessage, resolveIMSessionIdFromMessage, getLogger } from '@zhin.js/core';
import type { ZhinAgent } from './zhin-agent/index.js';
import { createNotificationRouter, type NotificationRouter } from './assistant/notification-router.js';
import type { ScheduleJob, ScheduleJobExecutionPlan } from './assistant/types.js';
import { scheduleJobCreatorFromPrincipal, senderFromScheduleCreator } from './assistant/job-creator.js';
import type { ScheduleInvocationContext } from './assistant/schedule-job-service.js';
import { deliverScheduleToAdapter } from './assistant/deliver-schedule-to-adapter.js';
import { KeyedMutex } from './utils/keyed-mutex.js';
import {
  ScheduleExecutionDomainImpl,
  type ScheduleExecutionDomain,
  type ScheduleExecutionResult,
} from './schedule-domain/execution-domain.js';
import { demoteScheduleCreator } from './schedule-domain/security-harness.js';
import { JsonlScheduleAuditLogger } from './schedule-domain/audit-logger.js';

const logger = getLogger('task-executor');
const sceneLocks = new KeyedMutex();

export interface TaskExecutionResult extends ScheduleExecutionResult {
  responseText: string;
  executionPlan?: ScheduleJobExecutionPlan;
}

export interface TaskExecutorDeps {
  agent: ZhinAgent;
  resolveAdapter: (platform: string) => { sendMessage: (opts: import('@zhin.js/core').SendOptions) => Promise<string> } | undefined;
  router?: NotificationRouter;
  defaultNotify?: import('./assistant/types.js').JobNotify;
  domain?: ScheduleExecutionDomain;
  dataDir?: string;
}

export interface TaskExecutionOptions {
  previewSource?: ScheduleInvocationContext;
}

function buildExecutionMessage(job: ScheduleJob, notify: import('./assistant/types.js').JobNotify): Message {
  const im = notify.channel === 'im' ? notify : undefined;
  const scene = im?.target.scene;
  const sceneId = scene?.sceneId || 'cron';
  const scope = scene?.kind || 'private';
  const creator = job.createdBy ? demoteScheduleCreator(job.createdBy) : undefined;
  const sender = creator
    ? senderFromScheduleCreator(creator)
    : { id: 'schedule', name: 'schedule', isMaster: false, isTrusted: false };
  return createSyntheticMessage({
    adapter: scene?.platform || 'cron',
    endpoint: scene?.endpointKey || 'default',
    sender,
    channel: { type: scope, id: sceneId },
  });
}

function buildPreviewMessage(job: ScheduleJob, source: ScheduleInvocationContext): Message {
  const creator = demoteScheduleCreator(
    job.createdBy ?? scheduleJobCreatorFromPrincipal(source.principal),
  );
  const im = source.origin.kind === 'im' ? source.origin : undefined;
  return createSyntheticMessage({
    adapter: im?.platform ?? source.origin.kind,
    endpoint: im?.endpoint ?? 'preview',
    sender: senderFromScheduleCreator(creator),
    channel: { type: im?.scope ?? 'private', id: im?.sceneId ?? creator.userId },
    id: im?.messageId,
  });
}

export function createTaskExecutor(deps: TaskExecutorDeps) {
  const router = deps.router ?? createNotificationRouter({ resolveAdapter: deps.resolveAdapter });
  const domain = deps.domain ?? new ScheduleExecutionDomainImpl({
    agent: deps.agent,
    auditLogger: new JsonlScheduleAuditLogger(deps.dataDir),
  });

  async function execute(job: ScheduleJob, options: TaskExecutionOptions = {}): Promise<TaskExecutionResult> {
    const previewSource = options.previewSource;
    const effectiveNotify = router.resolveEffectiveNotify(job.notify, deps.defaultNotify);
    const commMessage = previewSource
      ? buildPreviewMessage(job, previewSource)
      : buildExecutionMessage(job, effectiveNotify);
    const emitter = deps.agent.getEventEmitter();
    const event = (name: 'schedule.start' | 'schedule.finish' | 'schedule.error') => {
      if (!job.activityFeedback) return;
      const sessionId = resolveIMSessionIdFromMessage(commMessage);
      emitter.emit(name, emitter.createPayload(sessionId, commMessage, 'text'));
    };
    const lockKey = previewSource
      ? `preview:${previewSource.sessionKey}`
      : (commMessage.$channel?.id ?? 'cron');

    event('schedule.start');
    const result = await sceneLocks.run(lockKey, () => domain.execute(job, commMessage, {
      preview: Boolean(previewSource),
    }));
    const executionPlan = previewSource
      ? {
          prompt: job.action.prompt,
          tools: result.toolsUsed.length ? result.toolsUsed : undefined,
          skills: result.audit.skillsResolved?.length ? result.audit.skillsResolved : undefined,
          previewSample: result.output || undefined,
          previewedAt: Date.now(),
          confirmed: false,
        }
      : job.executionPlan;

    if (!result.success) {
      event('schedule.error');
      logger.error(`[TaskExecutor] 执行失败: ${result.error ?? 'unknown error'}`);
    } else if (previewSource) {
      event('schedule.finish');
    } else {
      if (result.output) {
        await deliverScheduleToAdapter({
          notify: effectiveNotify,
          content: result.output,
          router,
          source: 'scheduled',
        });
      }
      event('schedule.finish');
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

export async function drainTaskExecutorLocks(timeoutMs: number): Promise<void> {
  await sceneLocks.drain(timeoutMs);
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;
