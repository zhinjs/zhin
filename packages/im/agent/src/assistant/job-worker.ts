/**
 * JobWorker — 执行 Agent 任务（TaskQueue：重试 / 并发 / 死信）
 */
import { Logger } from '@zhin.js/core';
import { getTaskQueue, initTaskQueue } from '../orchestrator/task-queue.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import type { AssistantQueueConfig } from './config.js';
import { resolveAssistantQueueConfig } from './config.js';
import type { JobNotify } from './types.js';

const logger = new Logger(null, 'assistant-job-worker');

export interface JobWorkerOptions {
  executor: TaskExecutor;
  queue?: AssistantQueueConfig;
  assistantEnabled?: boolean;
}

export class JobWorker {
  private executor: TaskExecutor;
  private queueCfg: ReturnType<typeof resolveAssistantQueueConfig>;

  constructor(options: JobWorkerOptions) {
    this.executor = options.executor;
    this.queueCfg = resolveAssistantQueueConfig(options.queue, options.assistantEnabled === true);
    if (this.queueCfg.enabled) {
      initTaskQueue({
        maxConcurrency: this.queueCfg.maxConcurrency,
        defaultMaxRetries: this.queueCfg.maxRetries,
        defaultTimeout: this.queueCfg.defaultTimeoutMs,
        enableDAG: false,
      });
    }
  }

  async run(
    jobId: string,
    prompt: string,
    options?: {
      notify?: JobNotify;
      label?: string;
    },
  ): Promise<TaskExecutionResult> {
    if (!this.queueCfg.enabled) {
      return this.executeDirect(jobId, prompt, options);
    }

    const label = options?.label || jobId;
    try {
      return await getTaskQueue().enqueueAndWait({
        name: label,
        description: jobId,
        priority: 'medium',
        maxRetries: this.queueCfg.maxRetries,
        timeout: this.queueCfg.defaultTimeoutMs,
        metadata: { assistantJobId: jobId },
        execute: async () => {
          const result = await this.executor.executeTask({
            prompt,
            notify: options?.notify,
            timeContext: true,
          });
          if (!result.success) {
            throw new Error(result.error || 'job failed');
          }
          return result;
        },
      });
    } catch (e: unknown) {
      const error = (e as Error)?.message || String(e);
      logger.warn(`Job ${label} dead-letter: ${error}`);
      return { success: false, error, responseText: '', durationMs: 0 };
    }
  }

  private async executeDirect(
    jobId: string,
    prompt: string,
    options?: {
      notify?: JobNotify;
      label?: string;
    },
  ): Promise<TaskExecutionResult> {
    const result = await this.executor.executeTask({
      prompt,
      notify: options?.notify,
      timeContext: true,
    });
    const label = options?.label;
    if (!result.success) {
      logger.warn(`Job ${label || jobId} failed: ${result.error || 'unknown'}`);
    }
    return result;
  }

  stop(): void {
    if (this.queueCfg.enabled) {
      getTaskQueue().stop();
    }
  }
}
