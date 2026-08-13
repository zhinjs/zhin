/** Generation-owned schedule management and canonical Agent Tool definitions. */
import {
  defineAgentTool,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  addScheduleJob,
  generateScheduleJobId,
  parseScheduleAddFromToolArgs,
  type ScheduleInvocationContext,
} from './assistant/schedule-job-service.js';
import type { ScheduleJobEngine } from './assistant/job-engine.js';
import type { TaskExecutionResult } from './task-executor.js';

export const SCHEDULE_JOBS_FILENAME = 'schedule-jobs.json';

export interface ScheduleManager {
  scheduleFeature: {
    getStatus(): Array<{
      id: string;
      kind: string;
      expression?: string;
      running: boolean;
      nextExecution: Date | null;
      plugin: string;
    }>;
  };
  engine: ScheduleJobEngine | null;
  previewTask?: (
    prompt: string,
    context: ScheduleInvocationContext,
    options?: { activityFeedback?: boolean },
  ) => Promise<TaskExecutionResult>;
}

export interface ScheduleToolRegistration {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

export { generateScheduleJobId };

function schema(
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}

function registration(
  name: string,
  description: string,
  inputSchema: Readonly<Record<string, unknown>>,
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => unknown | Promise<unknown>,
): ScheduleToolRegistration {
  return Object.freeze({
    name,
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description,
      inputSchema,
      execute,
    }),
  });
}

export function createScheduleTools(manager: ScheduleManager): readonly ScheduleToolRegistration[] {
  return Object.freeze([
    registration(
      'schedule_list',
      '列出所有调度任务：内存任务与持久化 schedule-jobs.json',
      schema(),
      async () => {
        const memory = manager.scheduleFeature.getStatus();
        const persistent = manager.engine
          ? (await manager.engine.listJobs()).map((job) => ({
              type: 'persistent' as const,
              id: job.id,
              schedule: job.schedule,
              prompt: job.action.kind === 'agent' ? job.action.prompt : undefined,
              label: job.label,
              enabled: job.enabled,
              notify: job.notify,
              createdAt: job.createdAt,
              state: job.state,
            }))
          : [];
        return { memory, persistent };
      },
    ),
    registration(
      'schedule_add',
      '添加持久化调度任务。中国大陆工作日必须使用 workday；支持 6 段 cron 或 delay_minutes 一次性任务。',
      schema({
        schedule_kind: { type: 'string', description: 'solar|lunar|workday|freeDay|holiday，默认 solar' },
        cron: { type: 'string', description: '6 段 cron（秒 分 时 日 月 周）' },
        delay_minutes: { type: 'number', description: '一次性延迟（分钟）' },
        prompt: { type: 'string', description: '到点 prompt' },
        label: { type: 'string', description: '标签' },
        notify_channel: { type: 'string', description: 'im | silent | log' },
        activity_feedback: { type: 'boolean', description: '是否发布 activity feedback' },
        budget_max_tokens: { type: 'number', description: 'token 硬上限' },
        budget_max_tool_calls: { type: 'number', description: '工具调用硬上限' },
        budget_timeout_ms: { type: 'number', description: '执行超时毫秒数' },
        execution_plan: { type: 'object', description: '预演确认后的执行计划' },
        refined_prompt: { type: 'string', description: '预演 refine 后的 prompt' },
        tools: { type: 'string', description: '逗号分隔的工具名' },
        skills: { type: 'string', description: '逗号分隔的技能名' },
      }, ['prompt']),
      async (input, context) => {
        if (!manager?.engine) return { error: '持久化调度引擎不可用' };
        const parsed = parseScheduleAddFromToolArgs(input, context);
        if ('error' in parsed) return { error: parsed.error };
        const job = await addScheduleJob(manager.engine, { ...parsed, id: generateScheduleJobId() });
        if (job.schedule.kind === 'at') {
          const time = new Date(job.schedule.atMs).toLocaleString('zh-CN', { hour12: false });
          return { success: true, id: job.id, message: `已安排一次性任务，将在 ${time} 执行` };
        }
        return { success: true, id: job.id, message: '已添加调度任务' };
      },
    ),
    registration(
      'schedule_preview',
      '预演调度任务；返回建议执行计划，确认后用 schedule_add 创建正式任务。',
      schema({
        prompt: { type: 'string', description: '任务 prompt' },
        activity_feedback: { type: 'boolean', description: '是否发布 activity feedback' },
      }, ['prompt']),
      async (input, context) => {
        if (!manager?.previewTask) return { error: '预演服务不可用' };
        const result = await manager.previewTask(String(input.prompt), context, {
          activityFeedback: input.activity_feedback === true,
        });
        if (!result.success) return { error: result.error || '预演失败' };
        return {
          success: true,
          preview: result.responseText,
          execution_plan: result.executionPlan,
          message: '预演完成。确认无误后使用 schedule_add 并传入 execution_plan 创建正式任务。',
        };
      },
    ),
    ...(['remove', 'pause', 'resume'] as const).map((operation) => registration(
      `schedule_${operation}`,
      `${operation === 'remove' ? '删除' : operation === 'pause' ? '暂停' : '恢复'}持久化调度任务（按任务 ID）`,
      schema({ id: { type: 'string', description: '任务 ID' } }, ['id']),
      async (input) => {
        if (!manager?.engine) return { error: '引擎不可用' };
        const id = String(input.id ?? '');
        const changed = operation === 'remove'
          ? await manager.engine.removeJob(id)
          : operation === 'pause'
            ? await manager.engine.pauseJob(id)
            : await manager.engine.resumeJob(id);
        return changed ? { success: true } : { error: '未找到' };
      },
    )),
  ]);
}
