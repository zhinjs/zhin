/**
 * 持久化调度任务 + AI 工具
 */
import { ZhinTool, type Message } from '@zhin.js/core';
import {
  createGenerationStore,
  type Dispose,
  type GenerationStoreContext,
} from '@zhin.js/plugin-runtime';
import {
  addScheduleJob,
  generateScheduleJobId,
  parseScheduleAddFromToolArgs,
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
  /** 调度任务预演（dry-run） */
  previewTask?: (
    prompt: string,
    message: Message,
    options?: { activityFeedback?: boolean },
  ) => Promise<TaskExecutionResult>;
}

const store = createGenerationStore<ScheduleManager>('zhin.agent.schedule-manager');

/** Generation-owned registration：随 `context.lifecycle` 反注册。 */
export function provideScheduleManager(
  context: GenerationStoreContext,
  manager: ScheduleManager,
): Dispose {
  return store.provide(context, manager);
}

export function getScheduleManager(): ScheduleManager | null {
  return store.tryUse() ?? null;
}

export { generateScheduleJobId };

export function createScheduleTools(): ZhinTool[] {
  const listTool = new ZhinTool('schedule_list')
    .desc('列出所有调度任务：内存任务与持久化 schedule-jobs.json')
    .keyword('定时任务', 'schedule', '计划任务')
    .tag('schedule', '定时')
    .execute(async () => {
      const m = getScheduleManager();
      if (!m) return { error: '调度服务不可用' };
      const memory = m.scheduleFeature.getStatus();
      const persistent = m.engine
        ? (await m.engine.listJobs()).map((j) => ({
            type: 'persistent' as const,
            id: j.id,
            schedule: j.schedule,
            prompt: j.action.kind === 'agent' ? j.action.prompt : undefined,
            label: j.label,
            enabled: j.enabled,
            notify: j.notify,
            createdAt: j.createdAt,
            state: j.state,
          }))
        : [];
      return { memory, persistent };
    });

  const addTool = new ZhinTool('schedule_add')
    .desc(
      '添加持久化调度任务。schedule_kind: solar|lunar|workday|freeDay|holiday。'
      + '中国大陆「工作日」必须用 workday（法定工作日含调休）。'
      + 'workday 示例：schedule_kind=workday, cron="0 0 9 * * *"。'
      + '或 delay_minutes 一次性。',
    )
    .tag('schedule', '定时')
    .param('schedule_kind', {
      type: 'string',
      description: 'solar|lunar|workday|freeDay|holiday。（默认 solar）',
    })
    .param('cron', {
      type: 'string',
      description: '6 段 cron（秒 分 时 日 月 周）。workday 仅填时刻如 "0 0 9 * * *"，日/月/周用 *',
    })
    .param('delay_minutes', { type: 'number', description: '一次性延迟（分钟）' })
    .param('prompt', { type: 'string', description: '到点 prompt' }, true)
    .param('label', { type: 'string', description: '标签' })
    .param('notify_channel', { type: 'string', description: 'im | silent | log' })
    .param('activity_feedback', {
      type: 'boolean',
      description: '到点执行时是否向 IM 发送 reaction/typing，默认 false',
    })
    .param('budget_max_tokens', { type: 'number', description: '本任务 token 硬上限（默认 32000）' })
    .param('budget_max_tool_calls', { type: 'number', description: '本任务工具调用硬上限（默认 15）' })
    .param('budget_timeout_ms', { type: 'number', description: '本任务执行超时毫秒数（默认 120000）' })
    .param('execution_plan', {
      type: 'object',
      description: '预演确认后的执行计划 { prompt, tools?, skills? }',
    })
    .param('refined_prompt', { type: 'string', description: '预演 refine 后的 prompt' })
    .param('tools', { type: 'string', description: '逗号分隔的工具名（来自预演）' })
    .param('skills', { type: 'string', description: '逗号分隔的技能名（来自预演）' })
    .execute(async (args, commMessage) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '持久化调度引擎不可用' };

      const input = parseScheduleAddFromToolArgs(args, commMessage);
      if ('error' in input) return { error: input.error };

      const job = await addScheduleJob(m.engine, {
        ...input,
        id: generateScheduleJobId(),
      });

      if (job.schedule.kind === 'at') {
        const timeStr = new Date(job.schedule.atMs).toLocaleString('zh-CN', { hour12: false });
        return { success: true, id: job.id, message: `已安排一次性任务，将在 ${timeStr} 执行` };
      }
      return { success: true, id: job.id, message: '已添加调度任务' };
    });

  const removeTool = new ZhinTool('schedule_remove')
    .desc('删除持久化调度任务（按任务 ID）')
    .keyword('删除定时', '取消任务', 'schedule remove')
    .tag('schedule', '定时')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.removeJob(args.id as string))
        ? { success: true }
        : { error: '未找到' };
    });

  const pauseTool = new ZhinTool('schedule_pause')
    .desc('暂停持久化调度任务（按任务 ID，可 resume 恢复）')
    .keyword('暂停定时', 'schedule pause')
    .tag('schedule', '定时')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.pauseJob(args.id as string)) ? { success: true } : { error: '未找到' };
    });

  const resumeTool = new ZhinTool('schedule_resume')
    .desc('恢复已暂停的持久化调度任务（按任务 ID）')
    .keyword('恢复定时', 'schedule resume')
    .tag('schedule', '定时')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.resumeJob(args.id as string)) ? { success: true } : { error: '未找到' };
    });

  const previewTool = new ZhinTool('schedule_preview')
    .desc(
      '预演调度任务（dry-run）：按创建者身份执行一次，将结果与推荐 tools/skills 返回供确认；'
      + '确认后请用 schedule_add 并传入 execution_plan 创建正式任务。',
    )
    .tag('schedule', '定时', '预演')
    .param('prompt', { type: 'string', description: '任务 prompt' }, true)
    .param('activity_feedback', {
      type: 'boolean',
      description: '预演时是否显示 reaction/typing，默认 false',
    })
    .execute(async (args, commMessage) => {
      const m = getScheduleManager();
      if (!m?.previewTask) return { error: '预演服务不可用' };
      if (!commMessage) return { error: '缺少会话上下文，无法预演' };

      const prompt = String(args.prompt);
      const result = await m.previewTask(prompt, commMessage, {
        activityFeedback: args.activity_feedback === true,
      });

      if (!result.success) {
        return { error: result.error || '预演失败' };
      }

      return {
        success: true,
        preview: result.responseText,
        execution_plan: result.executionPlan,
        message: '预演完成。确认无误后使用 schedule_add 并传入 execution_plan 创建正式任务。',
      };
    });

  return [listTool, addTool, previewTool, removeTool, pauseTool, resumeTool];
}
