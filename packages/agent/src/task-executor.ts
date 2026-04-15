/**
 * Unified task execution + delivery layer.
 *
 * Inspired by metabot's MessageBridge.executeApiTask():
 * - Accepts a prompt + context
 * - Calls ZhinAgent.process()
 * - Converts OutputElement[] → text
 * - Delivers via Adapter.sendMessage()
 * - Returns structured result with timing
 * - Per-sceneId mutex lock to prevent concurrent execution
 */
import type { MessageType, SendOptions } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import type { ZhinAgent } from './zhin-agent/index.js';
import type { CronJobContext } from './cron-engine.js';
import { Logger } from '@zhin.js/core';

const logger = new Logger(null, 'task-executor');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskExecutionOptions {
  /** The prompt to send to ZhinAgent */
  prompt: string;
  /** Delivery & routing context */
  context: CronJobContext;
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
  resolveAdapter: (platform: string) => { sendMessage: (opts: SendOptions) => Promise<string> } | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-sceneId mutex lock
// ─────────────────────────────────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(sceneId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sceneId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(sceneId, next.finally(() => {
    if (locks.get(sceneId) === next) locks.delete(sceneId);
  }));
  return next;
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
  async function executeTask(options: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const { prompt, context, timeContext } = options;
    const t0 = Date.now();

    try {
      // 1. Optionally prepend time context (no style guidance)
      let finalPrompt = prompt;
      if (timeContext) {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN', { hour12: false });
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[now.getDay()];
        finalPrompt = `[定时任务自动触发] 当前时间: ${timeStr} 星期${weekday}\n任务: ${prompt}`;
      }

      // 2. Call agent.process() with per-sceneId lock
      const sceneId = context.sceneId || 'default';
      const elements = await withLock(sceneId, () =>
        deps.agent.process(finalPrompt, {
          platform: context.platform || 'cron',
          senderId: context.senderId || 'system',
          botId: context.botId,
          sceneId: context.sceneId || 'cron',
          scope: (context.scope as any) || undefined,
        }),
      );

      // 3. Convert to text
      const text = elementsToText(elements);
      if (!text) {
        return { success: true, responseText: '', durationMs: Date.now() - t0 };
      }

      // 4. Deliver via adapter if context has enough routing info
      if (context.platform && context.botId && context.sceneId) {
        const adapter = deps.resolveAdapter(context.platform);
        if (adapter) {
          const sceneType = (context.scope || 'private') as MessageType;
          await adapter.sendMessage({
            context: context.platform,
            bot: context.botId,
            id: context.sceneId,
            type: sceneType,
            content: text,
          });
        } else {
          logger.warn(`[TaskExecutor] 找不到适配器: ${context.platform}`);
        }
      }

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
