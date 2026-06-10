/**
 * Unified task execution + delivery layer.
 *
 * Inspired by metabot's MessageBridge.executeApiTask():
 * - Accepts a prompt + notify
 * - Calls ZhinAgent.process()
 * - Converts OutputElement[] → text
 * - Delivers via NotificationRouter (M3)
 * - Returns structured result with timing
 * - Per-sceneId mutex lock to prevent concurrent execution
 */
import type { OutputElement } from '@zhin.js/ai';
import type { ZhinAgent } from './zhin-agent/index.js';
import { Logger } from '@zhin.js/core';
import {
  createNotificationRouter,
  type NotificationRouter,
} from './assistant/notification-router.js';
import type { JobNotify } from './assistant/types.js';

const logger = new Logger(null, 'task-executor');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskExecutionOptions {
  /** The prompt to send to ZhinAgent */
  prompt: string;
  /** 投递通道 */
  notify?: JobNotify;
  /** Whether to prepend current time info (default: false) */
  timeContext?: boolean;
}

export interface TaskExecutionResult {
  success: boolean;
  /** The text that was (or would have been) delivered */
  responseText: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Error message if success=false */
  error?: string;
}

export interface TaskExecutorDeps {
  agent: ZhinAgent;
  /** Resolve an adapter by platform name. Returns object with sendMessage if found. */
  resolveAdapter: (platform: string) => { sendMessage: (opts: import('@zhin.js/core').SendOptions) => Promise<string> } | undefined;
  /** M3：可选注入；未提供时按 resolveAdapter 创建 */
  router?: NotificationRouter;
  /** assistant.defaults.notify */
  defaultNotify?: JobNotify;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-sceneId mutex lock
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// OutputElement[] → string
// ─────────────────────────────────────────────────────────────────────────────

function elementsToText(elements: OutputElement[]): string {
  return elements.map(el => {
    if (el.type === 'text') return el.content || '';
    if (el.type === 'image') return `<image url="${el.url}"/>`;
    return '';
  }).join('\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createTaskExecutor(deps: TaskExecutorDeps) {
  const router = deps.router ?? createNotificationRouter({ resolveAdapter: deps.resolveAdapter });

  async function executeTask(options: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const { prompt, notify, timeContext } = options;
    const t0 = Date.now();

    const effectiveNotify = router.resolveEffectiveNotify(notify, deps.defaultNotify);

    try {
      let finalPrompt = prompt;
      if (timeContext) {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN', { hour12: false });
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[now.getDay()];
        finalPrompt = [
          `[系统] 这是定时任务自动触发，当前时间: ${timeStr} 星期${weekday}`,
          `你的输出将被直接发送到目标聊天中，请注意：`,
          `- 直接输出最终内容，不要包含任何确认、进度报告或元评论（如"收到""正在执行""已完成"等）`,
          `- 不要使用"为您""帮你"等对话式措辞，你不是在回复某个人的请求`,
          `- 像一个真实的群成员一样自然发言`,
          ``,
          `任务: ${prompt}`,
        ].join('\n');
      }

      const im = effectiveNotify.channel === 'im' ? effectiveNotify : undefined;
      const sceneId = im?.sceneId || 'default';
      const elements = await withLock(sceneId, () =>
        deps.agent.process(finalPrompt, {
          platform: im?.platform || 'cron',
          senderId: 'system',
          botId: im?.botId,
          sceneId: im?.sceneId || 'cron',
          scope: (im?.scope as 'private' | 'group' | 'channel' | undefined) || undefined,
        }),
      );

      const text = elementsToText(elements);
      if (!text) {
        return { success: true, responseText: '', durationMs: Date.now() - t0 };
      }

      await router.deliver({ notify: effectiveNotify, content: text });

      return { success: true, responseText: text, durationMs: Date.now() - t0 };
    } catch (e) {
      const error = (e as Error).message || String(e);
      logger.error(`[TaskExecutor] 执行失败: ${error}`);
      return { success: false, responseText: '', durationMs: Date.now() - t0, error };
    }
  }

  return { executeTask, resolveAdapter: deps.resolveAdapter };
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>;
