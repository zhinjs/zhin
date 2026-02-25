/**
 * 持久化定时任务 CLI（与 data/cron-jobs.json 格式一致，需重启应用生效）
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';

const CRON_JOBS_FILENAME = 'cron-jobs.json';

interface CronJobRecord {
  id: string;
  cronExpression: string;
  prompt: string;
  label?: string;
  enabled: boolean;
  createdAt: number;
}

function getCronJobsPath(): string {
  return path.join(process.cwd(), 'data', CRON_JOBS_FILENAME);
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

function generateId(): string {
  return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── list ──
const listCommand = new Command('list')
  .description('列出所有持久化定时任务')
  .action(async () => {
    const jobs = await readJobs();
    if (jobs.length === 0) {
      logger.log('暂无定时任务。使用 zhin cron add "<cron表达式>" "<prompt>" 添加。');
      return;
    }
    for (const j of jobs) {
      const status = j.enabled ? '启用' : '暂停';
      const label = j.label ? ` (${j.label})` : '';
      logger.log(`  ${j.id}${label}  [${status}]`);
      logger.log(`    表达式: ${j.cronExpression}`);
      logger.log(`    内容:   ${j.prompt}`);
    }
    logger.log('\n修改后需重启应用 (zhin start / zhin dev) 后生效。');
  });

// ── add ──
const addCommand = new Command('add')
  .description('添加持久化定时任务（Cron 表达式 + 触发时发给 AI 的 prompt）')
  .argument('<cronExpression>', 'Cron 表达式，如 "0 9 * * *" 表示每天 9:00')
  .argument('<prompt>', '到点触发时发给 AI 的提示词')
  .option('-l, --label <label>', '可选标签')
  .action(async (cronExpression: string, prompt: string, opts: { label?: string }) => {
    const jobs = await readJobs();
    const id = generateId();
    jobs.push({
      id,
      cronExpression,
      prompt,
      label: opts.label,
      enabled: true,
      createdAt: Date.now(),
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
