/**
 * 持久化调度任务 CLI — data/schedule-jobs.json
 */
import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import {
  type ScheduleJobRecordCli,
  type JobScheduleCli,
  parseNotifyChannel,
  readScheduleJobs,
  writeScheduleJobs,
  normalizeCronExpression,
} from '../utils/assistant-jobs.js';

function parseEveryMs(s: string): number {
  const m = s.trim().match(/^(\d+)(m|h|d|s)$/i);
  if (!m) throw new Error(`Invalid --every format: ${s}. Use e.g. 30m, 1h, 1d`);
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  throw new Error(`Unknown unit: ${unit}`);
}

function generateId(): string {
  return `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function notifySummary(notify: ScheduleJobRecordCli['notify']): string {
  if (notify.channel === 'silent') return 'silent';
  if (notify.channel === 'log') return 'log';
  const parts: string[] = [notify.channel];
  if (notify.platform) parts.push(notify.platform);
  if (notify.sceneId) parts.push(`scene:${notify.sceneId}`);
  return parts.join('/');
}

function scheduleSummary(s: JobScheduleCli): string {
  if (s.kind === 'at') return `at ${new Date(s.atMs).toISOString()}`;
  if (s.kind === 'every') {
    const m = s.everyMs / (60 * 1000);
    if (m < 60) return `every ${m}m`;
    const h = m / 60;
    if (h < 24) return `every ${h}h`;
    return `every ${h / 24}d`;
  }
  return `${s.kind} ${s.cron}`;
}

const listCommand = new Command('list')
  .description('列出 data/schedule-jobs.json 中的持久化调度任务')
  .action(async () => {
    const jobs = await readScheduleJobs();
    if (jobs.length === 0) {
      logger.log('暂无调度任务。使用 zhin schedule add 添加。');
      return;
    }
    logger.log('\n调度任务（修改后需重启应用生效）\n');
    for (const j of jobs) {
      const status = j.enabled ? '启用' : '暂停';
      const label = j.label ? ` (${j.label})` : '';
      logger.log(`  ${j.id}${label}  [${status}]`);
      logger.log(`    计划:   ${scheduleSummary(j.schedule)}`);
      logger.log(`    投递:   ${notifySummary(j.notify)}`);
      logger.log(`    内容:   ${j.action.prompt}`);
    }
    logger.log('\n重启应用 (zhin start / zhin dev) 后生效。');
  });

const addCommand = new Command('add')
  .description('添加持久化调度任务（6 段 cron，或 --at / --every）')
  .argument('[cronExpression]', 'Cron 表达式，如 "0 0 9 * * *"（与 --at/--every 二选一）')
  .argument('<prompt>', '到点触发时发给 AI 的提示词')
  .option('-l, --label <label>', '可选标签')
  .option('--kind <kind>', 'solar|lunar|workday|freeDay（默认 solar）', 'solar')
  .option('--notify-channel <channel>', '结果投递：im | silent | log（默认 silent）', 'silent')
  .option('--at <iso8601>', '单次执行时间，ISO8601')
  .option('--every <interval>', '固定间隔，如 30m, 1h, 1d')
  .action(async (cronExpression: string, prompt: string, opts: {
    label?: string;
    kind?: string;
    notifyChannel?: string;
    at?: string;
    every?: string;
  }) => {
    const now = Date.now();
    let notify;
    try {
      notify = parseNotifyChannel(opts.notifyChannel ?? 'silent');
    } catch (e) {
      logger.error((e as Error).message);
      process.exit(1);
    }

    let schedule: JobScheduleCli;
    if (opts.at) {
      const atMs = new Date(opts.at).getTime();
      if (Number.isNaN(atMs) || atMs <= now) {
        logger.error('--at 必须是未来的有效 ISO8601 时间');
        process.exit(1);
      }
      schedule = { kind: 'at', atMs, deleteAfterRun: true };
    } else if (opts.every) {
      schedule = { kind: 'every', everyMs: parseEveryMs(opts.every) };
    } else {
      if (!cronExpression?.trim()) {
        logger.error('请提供 Cron 表达式，或使用 --at / --every');
        process.exit(1);
      }
      const kind = (opts.kind ?? 'solar').trim() as JobScheduleCli['kind'];
      if (!['solar', 'lunar', 'workday', 'freeDay'].includes(kind)) {
        logger.error('--kind 无效');
        process.exit(1);
      }
      const cron = normalizeCronExpression(cronExpression);
      schedule = { kind, cron } as JobScheduleCli;
    }

    const jobs = await readScheduleJobs();
    const id = generateId();
    jobs.push({
      id,
      label: opts.label,
      enabled: true,
      schedule,
      action: { kind: 'agent', prompt },
      notify,
      createdAt: now,
      updatedAt: now,
      state: {},
      source: 'manual',
    });
    await writeScheduleJobs(process.cwd(), jobs);
    logger.log(`已添加调度任务: ${id}`);
    logger.log('重启应用后生效。');
  });

const removeCommand = new Command('remove')
  .description('按 ID 删除持久化调度任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    const jobs = await readScheduleJobs();
    const next = jobs.filter((j) => j.id !== id);
    if (next.length === jobs.length) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    await writeScheduleJobs(process.cwd(), next);
    logger.log(`已删除任务: ${id}`);
  });

const pauseCommand = new Command('pause')
  .description('暂停指定任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    const jobs = await readScheduleJobs();
    const j = jobs.find((x) => x.id === id);
    if (!j) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    j.enabled = false;
    j.updatedAt = Date.now();
    await writeScheduleJobs(process.cwd(), jobs);
    logger.log(`已暂停任务: ${id}`);
  });

const resumeCommand = new Command('resume')
  .description('恢复已暂停的任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    const jobs = await readScheduleJobs();
    const j = jobs.find((x) => x.id === id);
    if (!j) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    j.enabled = true;
    j.updatedAt = Date.now();
    await writeScheduleJobs(process.cwd(), jobs);
    logger.log(`已恢复任务: ${id}`);
  });

export const scheduleCommand = new Command('schedule')
  .description('持久化调度任务（data/schedule-jobs.json）')
  .addCommand(listCommand)
  .addCommand(addCommand)
  .addCommand(removeCommand)
  .addCommand(pauseCommand)
  .addCommand(resumeCommand);

/** @deprecated 使用 schedule */
export const cronCommand = scheduleCommand;
