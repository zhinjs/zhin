/**
 * 持久化调度任务 + AI 工具
 */
import { ZhinTool, Logger, messageToIMDeliveryTarget } from '@zhin.js/core';
import type { FestivalName } from '@zhin.js/kernel';
import type { JobNotify, JobSchedule, ScheduleJob } from './assistant/types.js';
import type { ScheduleJobEngine } from './assistant/job-engine.js';
import { buildJobScheduleFromCronInput } from './schedule-cron.js';

const logger = new Logger(null, 'schedule-manager');

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
}

let scheduleManager: ScheduleManager | null = null;

export function setScheduleManager(m: ScheduleManager | null): void {
  scheduleManager = m;
}

export function getScheduleManager(): ScheduleManager | null {
  return scheduleManager;
}

export function generateScheduleJobId(): string {
  return `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type PromptOptimizer = (rawPrompt: string, schedule: JobSchedule) => Promise<string>;

function buildScheduleFromArgs(args: Record<string, unknown>): JobSchedule | { error: string } {
  const kind = args.schedule_kind as string | undefined;
  const cron = args.cron as string | undefined;
  const delayMin = args.delay_minutes as number | undefined;

  if (String(kind || '').toLowerCase() === 'at' || (delayMin && delayMin > 0)) {
    const atMs = delayMin && delayMin > 0
      ? Date.now() + delayMin * 60 * 1000
      : args.at_ms != null ? Number(args.at_ms) : undefined;
    if (!atMs) return { error: '请提供 delay_minutes 或 at_ms' };
    return { kind: 'at', atMs, deleteAfterRun: true };
  }

  if (!cron) {
    return { error: '请提供 6 段 cron 表达式（秒 分 时 日 月 周）' };
  }

  const built = buildJobScheduleFromCronInput(kind, cron);
  if ('error' in built) return built;

  if (built.kind === 'holiday') {
    const festivals = args.festivals;
    return {
      ...built,
      festivals: Array.isArray(festivals) ? festivals as FestivalName[] : undefined,
      everyDayOfHoliday: args.every_day_of_holiday === true,
    };
  }

  return built;
}

export function createScheduleTools(options?: { optimizePrompt?: PromptOptimizer }): ZhinTool[] {
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
    .execute(async (args, commMessage) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '持久化调度引擎不可用' };

      const built = buildScheduleFromArgs(args);
      if ('error' in built) return { error: built.error };

      const id = generateScheduleJobId();
      let finalPrompt = String(args.prompt);
      if (options?.optimizePrompt) {
        try {
          finalPrompt = await options.optimizePrompt(finalPrompt, built);
        } catch (e) {
          logger.warn('Prompt optimization failed: ' + (e as Error).message);
        }
      }

      const notifyChannel = String(args.notify_channel || 'im').toLowerCase();
      let notify: JobNotify;
      if (notifyChannel === 'silent') {
        notify = { channel: 'silent' };
      } else if (notifyChannel === 'log') {
        notify = { channel: 'log' };
      } else if (notifyChannel !== 'im') {
        return { error: `notify_channel 无效: ${notifyChannel}` };
      } else {
        const target = commMessage ? messageToIMDeliveryTarget(commMessage) : undefined;
        notify = target ? { channel: 'im', target } : { channel: 'silent' };
      }

      const job = await m.engine.addJob({
        id,
        label: args.label as string | undefined,
        enabled: true,
        schedule: built,
        action: { kind: 'agent', prompt: finalPrompt },
        notify,
      });

      if (built.kind === 'at') {
        const timeStr = new Date(built.atMs).toLocaleString('zh-CN', { hour12: false });
        return { success: true, id: job.id, message: `已安排一次性任务，将在 ${timeStr} 执行` };
      }
      return { success: true, id: job.id, message: '已添加调度任务' };
    });

  const removeTool = new ZhinTool('schedule_remove')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.removeJob(args.id as string))
        ? { success: true }
        : { error: '未找到' };
    });

  const pauseTool = new ZhinTool('schedule_pause')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.pauseJob(args.id as string)) ? { success: true } : { error: '未找到' };
    });

  const resumeTool = new ZhinTool('schedule_resume')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getScheduleManager();
      if (!m?.engine) return { error: '引擎不可用' };
      return (await m.engine.resumeJob(args.id as string)) ? { success: true } : { error: '未找到' };
    });

  return [listTool, addTool, removeTool, pauseTool, resumeTool];
}
