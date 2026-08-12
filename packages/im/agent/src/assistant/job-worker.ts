/**
 * JobWorker — 执行 Agent 任务（TaskQueue：重试 / 并发 / 死信）
 */
import { getLogger } from '@zhin.js/core';
import { getTaskQueue } from '../orchestrator/task-queue.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import { type AssistantQueueConfig, resolveAssistantQueueConfig } from './config.js';
import type { ScheduleJob } from './types.js';
import { createScheduleAuditRecord } from '../schedule-domain/audit-logger.js';
const logger = getLogger('assistant-job-worker');

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
  }

  async run(
    job: ScheduleJob,
  ): Promise<TaskExecutionResult> {
    if (!this.queueCfg.enabled) {
      return this.executeDirect(job);
    }

    const label = job.label || job.id;
    try {
      return await getTaskQueue().enqueueAndWait({
        name: label,
        description: job.id,
        priority: 'medium',
        maxRetries: this.queueCfg.maxRetries,
        timeout: this.queueCfg.defaultTimeoutMs,
        metadata: { assistantJobId: job.id },
        execute: async () => {
          const result = await this.executor.execute(job);
          if (!result.success) {
            throw new Error(result.error || 'job failed');
          }
          return result;
        },
      });
    } catch (e: unknown) {
      const error = (e as Error)?.message || String(e);
      logger.warn(`Job ${label} dead-letter: ${error}`);
      const timestamp = Date.now();
      return {
        success: false,
        error,
        responseText: '',
        output: '',
        durationMs: 0,
        toolsUsed: [],
        tokenUsage: { input: 0, output: 0 },
        audit: createScheduleAuditRecord({
          jobId: job.id,
          executionId: `queue-${timestamp}`,
          timestamp,
          createdBy: job.createdBy,
          prompt: job.action.prompt,
          toolsResolved: [],
          toolsResolvedBy: job.executionPlan ? 'execution-plan' : 'affinity',
          skillsResolved: [],
          missingTools: [],
          missingSkills: [],
          toolsUsed: [],
          tokenUsage: { input: 0, output: 0 },
          durationMs: 0,
          securityDenials: [],
          success: false,
          outputLength: 0,
          outputStripped: [],
          error,
        }),
      };
    }
  }

  private async executeDirect(
    job: ScheduleJob,
  ): Promise<TaskExecutionResult> {
    const result = await this.executor.execute(job);
    const label = job.label;
    if (!result.success) {
      logger.warn(`Job ${label || job.id} failed: ${result.error || 'unknown'}`);
    }
    return result;
  }

  stop(): void {
    if (this.queueCfg.enabled) {
      getTaskQueue().stop();
    }
  }
}
