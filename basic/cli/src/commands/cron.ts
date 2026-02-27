/**
 * 持久化定时任务 CLI
 * - Cron 任务：data/cron-jobs.json（需重启生效）
 * - 单次/间隔任务：data/scheduler-jobs.json（at/every，与 Scheduler 对齐，重启后自动加载）
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

const CRON_JOBS_FILENAME = 'cron-jobs.json';
const SCHEDULER_JOBS_FILENAME = 'scheduler-jobs.json';

interface CronJobRecord {
  id: string;
  cronExpression: string;
  prompt: string;
  label?: string;
  enabled: boolean;
  createdAt: number;
}

/** 解析 --every 间隔字符串为毫秒，如 "30m" "1h" "1d" */
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

function getCronJobsPath(): string {
  return path.join(process.cwd(), 'data', CRON_JOBS_FILENAME);
}

function getSchedulerJobsPath(): string {
  return path.join(process.cwd(), 'data', SCHEDULER_JOBS_FILENAME);
}

async function readJobs(): Promise<CronJobRecord[]> {
  const filePath = getCronJobsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeJobs(jobs: CronJobRecord[]): Promise<void> {
  const filePath = getCronJobsPath();
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(jobs, null, 2), 'utf-8');
}

interface SchedulerJobRecord {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: 'at' | 'every' | 'cron'; atMs?: number; everyMs?: number; expr?: string; tz?: string };
  payload: { kind: string; message: string; deliver: boolean; channel?: string; to?: string };
  state: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string; lastError?: string };
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun: boolean;
}

async function readSchedulerStore(): Promise<{ version: number; jobs: SchedulerJobRecord[] }> {
  const filePath = getSchedulerJobsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return { version: data.version ?? 1, jobs: data.jobs ?? [] };
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { version: 1, jobs: [] };
    throw e;
  }
}

async function writeSchedulerStore(store: { version: number; jobs: SchedulerJobRecord[] }): Promise<void> {
  const filePath = getSchedulerJobsPath();
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function generateId(): string {
  return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 截断错误信息便于列表展示 */
function truncateLastError(err: string | undefined, maxLen: number = 60): string {
  if (!err) return '-';
  return err.length <= maxLen ? err : err.slice(0, maxLen) + '...';
}

/** 将 schedule 转为简短描述 */
function scheduleSummary(s: SchedulerJobRecord['schedule']): string {
  if (s.kind === 'at' && s.atMs != null) return `at ${new Date(s.atMs).toISOString()}`;
  if (s.kind === 'every' && s.everyMs != null) {
    const m = s.everyMs / (60 * 1000);
    if (m < 60) return `every ${m}m`;
    const h = m / 60;
    if (h < 24) return `every ${h}h`;
    return `every ${h / 24}d`;
  }
  if (s.kind === 'cron' && s.expr) return `cron ${s.expr}`;
  return String(s.kind);
}

// ── list ──
const listCommand = new Command('list')
  .description('列出所有持久化定时任务（Cron + Scheduler）')
  .action(async () => {
    const cronJobs = await readJobs();
    const { jobs: schedulerJobs } = await readSchedulerStore();

    if (cronJobs.length === 0 && schedulerJobs.length === 0) {
      logger.log('暂无定时任务。使用 zhin cron add "<cron表达式>" "<prompt>" 或 --at / --every 添加。');
      return;
    }

    if (cronJobs.length > 0) {
      logger.log('\nCron 任务（修改后需重启应用生效）\n');
      for (const j of cronJobs) {
        const status = j.enabled ? '启用' : '暂停';
        const label = j.label ? ` (${j.label})` : '';
        logger.log(`  ${j.id}${label}  [${status}]`);
        logger.log(`    表达式: ${j.cronExpression}`);
        logger.log(`    内容:   ${j.prompt}`);
      }
    }

    if (schedulerJobs.length > 0) {
      logger.log('\nScheduler 任务（由运行中的进程加载；lastStatus/lastError 为上次执行结果）\n');
      for (const j of schedulerJobs) {
        const status = j.enabled ? '启用' : '暂停';
        const lastStatus = j.state?.lastStatus ?? '-';
        const lastError = truncateLastError(j.state?.lastError);
        const schedule = scheduleSummary(j.schedule);
        logger.log(`  ${j.id}  ${j.name}  [${status}]  ${schedule}`);
        logger.log(`    上次状态: ${lastStatus}${lastError !== '-' ? `  错误: ${lastError}` : ''}`);
        if (j.payload?.message) logger.log(`    内容: ${j.payload.message.slice(0, 80)}${j.payload.message.length > 80 ? '...' : ''}`);
      }
    }

    logger.log('\nCron 任务需重启应用 (zhin start / zhin dev) 后生效；Scheduler 任务由运行中进程加载。');
  });

// ── add ──
const addCommand = new Command('add')
  .description('添加持久化定时任务（Cron 表达式，或 --at 单次 / --every 间隔）')
  .argument('[cronExpression]', 'Cron 表达式，如 "0 9 * * *"（与 --at/--every 二选一）')
  .argument('<prompt>', '到点触发时发给 AI 的提示词')
  .option('-l, --label <label>', '可选标签')
  .option('--at <iso8601>', '单次执行时间，ISO8601 如 2025-12-31T09:00:00')
  .option('--every <interval>', '固定间隔，如 30m, 1h, 1d')
  .action(async (cronExpression: string, prompt: string, opts: { label?: string; at?: string; every?: string }) => {
    const now = Date.now();
    const label = opts.label ?? 'scheduled';

    if (opts.at) {
      const atMs = new Date(opts.at).getTime();
      if (Number.isNaN(atMs) || atMs <= now) {
        logger.error('--at 必须是未来的有效 ISO8601 时间');
        process.exit(1);
      }
      const store = await readSchedulerStore();
      const job: SchedulerJobRecord = {
        id: randomUUID().slice(0, 8),
        name: label,
        enabled: true,
        schedule: { kind: 'at', atMs },
        payload: { kind: 'agent_turn', message: prompt, deliver: false },
        state: { nextRunAtMs: atMs },
        createdAtMs: now,
        updatedAtMs: now,
        deleteAfterRun: true,
      };
      store.jobs.push(job);
      await writeSchedulerStore(store);
      logger.log(`已添加单次任务: ${job.id}，执行时间: ${opts.at}`);
      logger.log('应用运行中会到点执行；若未运行则下次启动后若已过时不会执行。');
      return;
    }

    if (opts.every) {
      const everyMs = parseEveryMs(opts.every);
      const store = await readSchedulerStore();
      const job: SchedulerJobRecord = {
        id: randomUUID().slice(0, 8),
        name: label,
        enabled: true,
        schedule: { kind: 'every', everyMs },
        payload: { kind: 'agent_turn', message: prompt, deliver: false },
        state: { nextRunAtMs: now + everyMs },
        createdAtMs: now,
        updatedAtMs: now,
        deleteAfterRun: false,
      };
      store.jobs.push(job);
      await writeSchedulerStore(store);
      logger.log(`已添加间隔任务: ${job.id}，间隔: ${opts.every}`);
      logger.log('应用运行中会按间隔执行；重启后自动加载。');
      return;
    }

    if (!cronExpression || !cronExpression.trim()) {
      logger.error('请提供 Cron 表达式，或使用 --at / --every');
      process.exit(1);
    }
    const jobs = await readJobs();
    const id = generateId();
    jobs.push({
      id,
      cronExpression: cronExpression.trim(),
      prompt,
      label: opts.label,
      enabled: true,
      createdAt: now,
    });
    await writeJobs(jobs);
    logger.log(`已添加定时任务: ${id}`);
    logger.log('重启应用后生效。');
  });

// ── remove ──
const removeCommand = new Command('remove')
  .description('按 ID 删除持久化定时任务')
  .argument('<id>', '任务 ID（zhin cron list 可查看）')
  .action(async (id: string) => {
    const jobs = await readJobs();
    const next = jobs.filter((j) => j.id !== id);
    if (next.length === jobs.length) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    await writeJobs(next);
    logger.log(`已删除任务: ${id}`);
    logger.log('重启应用后生效。');
  });

// ── pause / resume（可选）
const pauseCommand = new Command('pause')
  .description('暂停指定任务（不删除，重启后不执行）')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    const jobs = await readJobs();
    const j = jobs.find((x) => x.id === id);
    if (!j) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    j.enabled = false;
    await writeJobs(jobs);
    logger.log(`已暂停任务: ${id}`);
  });

const resumeCommand = new Command('resume')
  .description('恢复已暂停的任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    const jobs = await readJobs();
    const j = jobs.find((x) => x.id === id);
    if (!j) {
      logger.error(`未找到任务: ${id}`);
      process.exit(1);
    }
    j.enabled = true;
    await writeJobs(jobs);
    logger.log(`已恢复任务: ${id}`);
  });

export const cronCommand = new Command('cron')
  .description('持久化定时任务（到点由 AI 执行 prompt，数据存于 data/cron-jobs.json）')
  .addCommand(listCommand)
  .addCommand(addCommand)
  .addCommand(removeCommand)
  .addCommand(pauseCommand)
  .addCommand(resumeCommand);
