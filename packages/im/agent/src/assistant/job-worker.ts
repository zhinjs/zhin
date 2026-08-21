/**
 * JobWorker — 执行 Schedule Agent 任务（owned queue：重试 / 并发 / 死信）
 */
import { getLogger } from '@zhin.js/core';
import { ScheduleExecutionQueue } from '../schedule-domain/schedule-execution-queue.js';
import type { TaskExecutionResult, TaskExecutor } from '../task-executor.js';
import { type AssistantQueueConfig, resolveAssistantQueueConfig } from './config.js';
import type { ScheduleJob } from './types.js';
import { createScheduleAuditRecord } from '../schedule-domain/audit-logger.js';
const logger = getLogger('assistant-job-worker');

export interface JobWorkerOptions {
  executor: TaskExecutor;
  queue?: AssistantQueueConfig;
}

export class JobWorker {
  private executor: TaskExecutor;
  private queueCfg: ReturnType<typeof resolveAssistantQueueConfig>;
  private readonly queue: ScheduleExecutionQueue;

  constructor(options: JobWorkerOptions) {
    this.executor = options.executor;
    this.queueCfg = resolveAssistantQueueConfig(options.queue);
    this.queue = new ScheduleExecutionQueue({
      maxConcurrency: this.queueCfg.maxConcurrency,
      defaultMaxRetries: this.queueCfg.maxRetries,
      defaultTimeoutMs: this.queueCfg.defaultTimeoutMs,
    });
  }

  async run(
    job: ScheduleJob,
  ): Promise<TaskExecutionResult> {
    const label = job.label || job.id;
    try {
      return await this.queue.enqueueAndWait({
        name: label,
        maxRetries: this.queueCfg.maxRetries,
        timeoutMs: this.queueCfg.defaultTimeoutMs,
        execute: async signal => {
          const result = await this.executor.execute(job, { signal });
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

  async stop(): Promise<void> {
    await this.queue.dispose();
  }
}
