/**
 * Unified task execution + delivery layer.
 */
import type { OutputElement } from '@zhin.js/ai';
import { type Message, createSyntheticMessage, resolveIMSessionIdFromMessage, getLogger } from '@zhin.js/core';
import type { ZhinAgent } from './zhin-agent/index.js';
import {
  createNotificationRouter,
  type NotificationRouter,
} from './assistant/notification-router.js';
import type {
  JobNotify,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
} from './assistant/types.js';
import { senderFromScheduleCreator } from './assistant/job-creator.js';
import { buildScheduleTurnMessage } from './assistant/schedule-message.js';
import { buildScheduleTurnPrompt } from './assistant/schedule-execution.js';
import { deliverScheduleToAdapter } from './assistant/deliver-schedule-to-adapter.js';
const logger = getLogger('task-executor');

export interface TaskExecutionOptions {
  prompt: string;
  notify?: JobNotify;
  timeContext?: boolean;
  createdBy?: ScheduleJobCreator;
  /** 预演模式：结果回创建者，不投递 notify 目标 */
  preview?: boolean;
  /** 预演时使用创建者入站 Message（保留 messageId / 角色） */
  previewCommMessage?: Message;
  executionPlan?: ScheduleJobExecutionPlan;
  activityFeedback?: boolean;
  scheduleJobId?: string;
}

export interface TaskExecutionResult {
  success: boolean;
  responseText: string;
  durationMs: number;
  error?: string;
  executionPlan?: ScheduleJobExecutionPlan;
}

export interface TaskExecutorDeps {
  agent: ZhinAgent;
  resolveAdapter: (platform: string) => { sendMessage: (opts: import('@zhin.js/core').SendOptions) => Promise<string> } | undefined;
  router?: NotificationRouter;
  defaultNotify?: JobNotify;
  deliverIm?: (notify: JobNotify & { channel: 'im' }, content: string) => Promise<void>;
  proactiveOutbound?: import('./outbound/send-proactive.js').ProactiveOutboundService;
}

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(sceneId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sceneId) ?? Promise.resolve();
  let resolve!: () => void;
  const gate = new Promise<void>((r) => { resolve = r; });
  const next = prev.then(() => gate, () => gate);
  locks.set(sceneId, next.finally(() => {
    if (locks.get(sceneId) === next) locks.delete(sceneId);
  }));
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    resolve();
  }
}

function elementsToText(elements: OutputElement[]): string {
  return elements.map(el => {
    if (el.type === 'text') return el.content || '';
    if (el.type === 'image') return `<image url="${el.url}"/>`;
    return '';
  }).join('\n').trim();
}

export function createTaskExecutor(deps: TaskExecutorDeps) {
  const router = deps.router ?? createNotificationRouter({
    resolveAdapter: deps.resolveAdapter,
    sendIm: deps.deliverIm
      ? async (notify, content) => deps.deliverIm!(notify, content)
      : undefined,
  });

  async function executeTask(options: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const {
      prompt,
      notify,
      timeContext,
      createdBy,
      preview,
      previewCommMessage,
      executionPlan,
      activityFeedback,
      scheduleJobId,
    } = options;
    const t0 = Date.now();

    const effectiveNotify = router.resolveEffectiveNotify(notify, deps.defaultNotify);
    const basePrompt = executionPlan?.prompt?.trim() || prompt;
    const finalPrompt = preview
      ? buildScheduleTurnPrompt({ basePrompt, mode: 'preview' })
      : timeContext
        ? buildScheduleTurnPrompt({ basePrompt, mode: 'scheduled' })
        : basePrompt;

    deps.agent.initScheduleTurnContext({
      executionPlan,
      createdBy,
      preview: preview || undefined,
      activityFeedback: activityFeedback || undefined,
      jobId: scheduleJobId,
    });

    const emitter = deps.agent.getEventEmitter?.() ?? {
      emit: () => {},
      createPayload: (_sessionId: string, comm: Message) => ({
        sessionId: resolveIMSessionIdFromMessage(comm),
        source: 'zhin-agent' as const,
      }),
    };

    let commMessage: Message;
    if (preview && previewCommMessage) {
      commMessage = buildScheduleTurnMessage({ sourceMessage: previewCommMessage });
    } else {
      const im = effectiveNotify.channel === 'im' ? effectiveNotify : undefined;
      const scene = im?.target.scene;
      const sceneId = scene?.sceneId || 'cron';
      const scope = scene?.kind || 'private';
      const sender = createdBy
        ? senderFromScheduleCreator(createdBy)
        : { id: 'system', name: 'system', isMaster: true, isTrusted: false as const };
      commMessage = createSyntheticMessage({
        adapter: scene?.platform || 'cron',
        endpoint: scene?.endpointId || 'default',
        sender,
        channel: { type: scope, id: sceneId },
      });
    }

    const dispatchSchedule = (name: 'schedule.start' | 'schedule.finish' | 'schedule.error') => {
      if (!activityFeedback) return;
      const sessionId = resolveIMSessionIdFromMessage(commMessage);
      emitter.emit(name, emitter.createPayload(sessionId, commMessage, 'text'));
    };

    const lockKey = preview
      ? `preview:${resolveIMSessionIdFromMessage(previewCommMessage ?? commMessage)}`
      : (commMessage.$channel?.id ?? 'cron');

    try {
      dispatchSchedule('schedule.start');
      const elements = await withLock(lockKey, () =>
        deps.agent.process(finalPrompt, commMessage),
      );

      const text = elementsToText(elements);
      const captured = preview && typeof deps.agent.getLastTurnToolSnapshot === 'function'
        ? deps.agent.getLastTurnToolSnapshot()
        : { tools: [] as string[], skills: [] as string[] };
      const resultPlan: ScheduleJobExecutionPlan | undefined = preview
        ? {
            prompt: basePrompt,
            tools: captured.tools.length ? captured.tools : executionPlan?.tools,
            skills: captured.skills.length ? captured.skills : executionPlan?.skills,
            previewSample: text || undefined,
            previewedAt: Date.now(),
            confirmed: false,
          }
        : executionPlan;

      if (preview) {
        if (text && previewCommMessage && typeof previewCommMessage.$reply === 'function') {
          await previewCommMessage.$reply(text);
        }
        return {
          success: true,
          responseText: text,
          durationMs: Date.now() - t0,
          executionPlan: resultPlan,
        };
      }

      if (!text) {
        // spawn_task 委派时主回合 finalReply 为空；投递由 auto-continue + proactive 出站完成。
        if (timeContext && typeof deps.agent.waitForIdle === 'function') {
          await deps.agent.waitForIdle();
        }
        dispatchSchedule('schedule.finish');
        return { success: true, responseText: '', durationMs: Date.now() - t0, executionPlan: resultPlan };
      }

      await deliverScheduleToAdapter({
        notify: effectiveNotify,
        content: text,
        proactiveOutbound: deps.proactiveOutbound,
        router,
        resolveAdapter: deps.resolveAdapter,
      });
      dispatchSchedule('schedule.finish');
      return { success: true, responseText: text, durationMs: Date.now() - t0, executionPlan: resultPlan };
    } catch (e) {
      dispatchSchedule('schedule.error');
      const error = (e as Error).message || String(e);
      logger.error(`[TaskExecutor] 执行失败: ${error}`);
      return { success: false, responseText: '', durationMs: Date.now() - t0, error };
    }
  }

  return { executeTask, resolveAdapter: deps.resolveAdapter };
}

export async function drainTaskExecutorLocks(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (locks.size > 0 && Date.now() < deadline) {
    await Promise.allSettled([...locks.values()]);
  }
  locks.clear();
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;
