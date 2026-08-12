/** Delivery boundary for the independent schedule execution domain. */
import { type Message, createSyntheticMessage, resolveIMSessionIdFromMessage, getLogger } from '@zhin.js/core';
import type { ZhinAgent } from './zhin-agent/index.js';
import { createNotificationRouter, type NotificationRouter } from './assistant/notification-router.js';
import type { ScheduleJob, ScheduleJobCreator, ScheduleJobExecutionPlan } from './assistant/types.js';
import { captureScheduleJobCreator, senderFromScheduleCreator } from './assistant/job-creator.js';
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
  previewSourceMessage?: Message;
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

function buildPreviewMessage(job: ScheduleJob, source: Message): Message {
  const creator = demoteScheduleCreator(job.createdBy ?? {
    userId: String(source.$sender.id),
    name: source.$sender.name,
    roles: source.$sender.isMaster ? ['master'] : source.$sender.isTrusted ? ['trusted'] : ['user'],
  });
  return createSyntheticMessage({
    adapter: String(source.$adapter),
    endpoint: source.$endpoint,
    sender: senderFromScheduleCreator(creator),
    channel: source.$channel ?? { type: 'private', id: creator.userId },
    id: source.$id,
  });
}

export function createTaskExecutor(deps: TaskExecutorDeps) {
  const router = deps.router ?? createNotificationRouter({ resolveAdapter: deps.resolveAdapter });
  const domain = deps.domain ?? new ScheduleExecutionDomainImpl({
    agent: deps.agent,
    auditLogger: new JsonlScheduleAuditLogger(deps.dataDir),
  });

  async function execute(job: ScheduleJob, options: TaskExecutionOptions = {}): Promise<TaskExecutionResult> {
    const previewSource = options.previewSourceMessage;
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
      ? `preview:${resolveIMSessionIdFromMessage(previewSource)}`
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
      if (result.output && typeof previewSource.$reply === 'function') await previewSource.$reply(result.output);
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
    sourceMessage: Message,
    options: { createdBy?: ScheduleJobCreator; activityFeedback?: boolean } = {},
  ): Promise<TaskExecutionResult> {
    const now = Date.now();
    const job: ScheduleJob = {
      id: `preview-${sourceMessage.$id ?? now}`,
      enabled: true,
      schedule: { kind: 'at', atMs: now },
      action: { kind: 'agent', prompt },
      notify: { channel: 'silent' },
      createdAt: now,
      updatedAt: now,
      state: {},
      source: 'manual',
      createdBy: options.createdBy ?? captureScheduleJobCreator(sourceMessage),
      activityFeedback: options.activityFeedback,
    };
    return execute(job, { previewSourceMessage: sourceMessage });
  }

  return { execute, preview, resolveAdapter: deps.resolveAdapter };
}

export async function drainTaskExecutorLocks(timeoutMs: number): Promise<void> {
  await sceneLocks.drain(timeoutMs);
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;
