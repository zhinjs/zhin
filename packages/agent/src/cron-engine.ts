/**
 * 持久化定时任务
 *
 * 将定时任务持久化到 data/cron-jobs.json，进程重启后自动加载；
 * 触发时以 prompt 调用 ZhinAgent，实现「到点执行 AI 任务」。
 *
 * - 存储：id, cronExpression, prompt, label?, enabled, createdAt
 * - 启动时：读取文件 → 为每条启用的任务创建 Cron → 注册到 CronFeature
 * - CLI / AI 工具：可对持久化任务做 list / add / remove / pause / resume（AI 侧立即生效）
 */

import * as fs from 'fs';
import * as path from 'path';
import { Cron, ZhinTool } from '@zhin.js/core';
import type { ToolContext } from '@zhin.js/core';
import { Logger } from '@zhin.js/core';

const logger = new Logger(null, 'cron-engine');

// ─────────────────────────────────────────────────────────────────────────────
// 类型与存储路径
// ─────────────────────────────────────────────────────────────────────────────

export const CRON_JOBS_FILENAME = 'cron-jobs.json';

/** 定时任务执行时的上下文信息 */
export interface CronJobContext {
  /** 来源平台（adapter name），如 'icqq', 'discord' */
  platform?: string;
  /** Bot ID */
  botId?: string;
  /** 发送者 ID（创建者） */
  senderId?: string;
  /** 场景 ID（群号/频道ID/私聊用户ID） */
  sceneId?: string;
  /** 场景类型: private | group | channel */
  scope?: string;
}

export interface CronJobRecord {
  id: string;
  /** Cron 表达式，5 字段：分 时 日 月 周 */
  cronExpression: string;
  /** 触发时发给 AI 的 prompt */
  prompt: string;
  /** 可选标签，便于识别 */
  label?: string;
  /** 是否启用（暂停的任务不加载） */
  enabled: boolean;
  /** 执行时的上下文（缺省为 system/cron） */
  context?: CronJobContext;
  createdAt: number;
}

export function getCronJobsFilePath(dataDir: string): string {
  return path.join(dataDir, CRON_JOBS_FILENAME);
}

export async function readCronJobsFile(dataDir: string): Promise<CronJobRecord[]> {
  const filePath = getCronJobsFilePath(dataDir);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    logger.warn('读取定时任务文件失败: ' + (e?.message || String(e)));
    return [];
  }
}

export async function writeCronJobsFile(dataDir: string, jobs: CronJobRecord[]): Promise<void> {
  const filePath = getCronJobsFilePath(dataDir);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(jobs, null, 2), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 持久化引擎：加载文件并注册到 CronFeature
// ─────────────────────────────────────────────────────────────────────────────

export type CronRunner = (prompt: string, jobId: string, context?: CronJobContext) => void | Promise<void>;

export type AddCronFn = (cron: Cron) => () => void;

export interface PersistentCronEngineOptions {
  dataDir: string;
  addCron: AddCronFn;
  runner: CronRunner;
}

export class PersistentCronEngine {
  private options: PersistentCronEngineOptions;
  /** jobId -> dispose */
  private disposes = new Map<string, () => void>();

  constructor(options: PersistentCronEngineOptions) {
    this.options = options;
  }

  getDataDir(): string {
    return this.options.dataDir;
  }

  /**
   * 从文件加载任务并注册到 CronFeature；仅加载 enabled 的任务。
   */
  load(): void {
    const { dataDir, addCron, runner } = this.options;
    readCronJobsFile(dataDir).then((jobs) => {
      for (const job of jobs) {
        if (!job.enabled) continue;
        this.registerOne(job, addCron, runner);
      }
      if (jobs.filter((j) => j.enabled).length > 0) {
        logger.info(`已加载 ${this.disposes.size} 个持久化定时任务`);
      }
    }).catch((e) => {
      logger.warn('加载持久化定时任务失败: ' + (e?.message || String(e)));
    });
  }

  private registerOne(
    job: CronJobRecord,
    addCron: AddCronFn,
    runner: CronRunner,
  ): void {
    const { prompt, id: jobId, cronExpression, context } = job;
    try {
      const cron = new Cron(cronExpression, async () => {
        await runner(prompt, jobId, context);
      });
      cron.id = jobId;
      const dispose = addCron(cron);
      this.disposes.set(jobId, dispose);
    } catch (e: any) {
      logger.warn(`定时任务加载失败 [${jobId}]: ${e?.message || String(e)}`);
    }
  }

  /**
   * 列出所有持久化任务（从文件读取）
   */
  async listJobs(): Promise<CronJobRecord[]> {
    return readCronJobsFile(this.options.dataDir);
  }

  /**
   * 添加持久化任务并立即生效
   */
  async addJob(record: Omit<CronJobRecord, 'createdAt'> & { createdAt?: number }): Promise<CronJobRecord> {
    const jobs = await readCronJobsFile(this.options.dataDir);
    const full: CronJobRecord = {
      ...record,
      createdAt: record.createdAt ?? Date.now(),
      enabled: record.enabled ?? true,
    };
    jobs.push(full);
    await writeCronJobsFile(this.options.dataDir, jobs);
    if (full.enabled) {
      this.registerOne(full, this.options.addCron, this.options.runner);
    }
    return full;
  }

  /**
   * 删除持久化任务并立即生效
   */
  async removeJob(id: string): Promise<boolean> {
    const jobs = await readCronJobsFile(this.options.dataDir);
    const next = jobs.filter((j) => j.id !== id);
    if (next.length === jobs.length) return false;
    await writeCronJobsFile(this.options.dataDir, next);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  /**
   * 暂停任务（不删除，停止调度）
   */
  async pauseJob(id: string): Promise<boolean> {
    const jobs = await readCronJobsFile(this.options.dataDir);
    const j = jobs.find((x) => x.id === id);
    if (!j) return false;
    j.enabled = false;
    await writeCronJobsFile(this.options.dataDir, jobs);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  /**
   * 恢复已暂停的任务
   */
  async resumeJob(id: string): Promise<boolean> {
    const jobs = await readCronJobsFile(this.options.dataDir);
    const j = jobs.find((x) => x.id === id);
    if (!j) return false;
    j.enabled = true;
    await writeCronJobsFile(this.options.dataDir, jobs);
    this.registerOne(j, this.options.addCron, this.options.runner);
    return true;
  }

  /**
   * 卸载所有由本引擎注册的定时任务（用于 dispose）
   */
  unload(): void {
    for (const [id, dispose] of this.disposes) {
      try {
        dispose();
      } catch (e) {
        logger.warn(`Cron dispose failed for ${id}:`, e);
      }
    }
    this.disposes.clear();
  }
}

/**
 * 生成唯一 ID（用于 CLI / AI 添加时）
 */
export function generateCronJobId(): string {
  return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 供 AI 工具使用的 Cron 管理器引用（init 中设置）
// ─────────────────────────────────────────────────────────────────────────────

export interface CronManager {
  cronFeature: { getStatus(): Array<{ expression: string; running: boolean; nextExecution: Date | null; plugin: string }> };
  engine: PersistentCronEngine | null;
}

let cronManager: CronManager | null = null;

export function setCronManager(m: CronManager | null): void {
  cronManager = m;
}

export function getCronManager(): CronManager | null {
  return cronManager;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 可调用的定时任务管理工具
// ─────────────────────────────────────────────────────────────────────────────

export type PromptOptimizer = (rawPrompt: string, cronExpression: string) => Promise<string>;

export function createCronTools(options?: { optimizePrompt?: PromptOptimizer }): ZhinTool[] {
  const listTool = new ZhinTool('cron_list')
    .desc('列出所有定时任务：包括插件注册的内存任务与持久化任务（持久化任务有 id，可用于 cron_remove/cron_pause/cron_resume）')
    .keyword('定时任务', 'cron', '计划任务', '任务列表', '我的定时', '查看定时')
    .tag('cron', 'schedule', '定时')
    .execute(async () => {
      const m = getCronManager();
      if (!m) {
        return { error: '定时任务服务不可用' };
      }
      const memory = m.cronFeature.getStatus().map((s) => ({
        type: 'memory' as const,
        expression: s.expression,
        running: s.running,
        nextExecution: s.nextExecution?.toISOString() ?? null,
        plugin: s.plugin,
      }));
      const persistent = m.engine
        ? (await m.engine.listJobs()).map((j) => ({
            type: 'persistent' as const,
            id: j.id,
            cronExpression: j.cronExpression,
            prompt: j.prompt,
            label: j.label,
            enabled: j.enabled,
            context: j.context,
            createdAt: j.createdAt,
          }))
        : [];
      return { memory, persistent };
    });

  const addTool = new ZhinTool('cron_add')
    .desc('添加一条持久化定时任务。支持两种模式：1) cron_expression: 周期性任务(如每天9点)；2) delay_minutes: 一次性延迟提醒(如30分钟后)。执行后不删除。到点由 AI 执行 prompt 并投递结果，重启不丢失。')
    .keyword('添加定时', '新建定时任务', 'cron add', '定时任务', '定时推送', '每天', '每周', '每月', '自动推送', '自动发送', '定期', '定时提醒', '提醒我', '提醒', '分钟后', '小时后', '过一会', '别忘')
    .tag('cron', 'schedule', '定时', '提醒')
    .param('cron_expression', { type: 'string', description: 'Cron 表达式(分 时 日 月 周)。示例："0 9 * * *"=每天9点，"0 7-21 * * *"=每天7点到21点每整点，"*/30 * * * *"=每30分钟，"0 9 * * 1-5"=工作日9点，"0 9,18 * * *"=每天9点和18点。与 delay_minutes 二选一' })
    .param('delay_minutes', { type: 'number', description: '一次性延迟(分钟)，如 30 表示30分钟后执行一次。与 cron_expression 二选一' })
    .param('prompt', { type: 'string', description: '到点触发时发给 AI 的提示词（如"查询今日金价"）。如果只是简单提醒，可写提醒内容' }, true)
    .param('label', { type: 'string', description: '可选标签，便于识别' })
    .execute(async (args, toolContext) => {
      const m = getCronManager();
      if (!m?.engine) {
        return { error: '持久化定时任务引擎不可用' };
      }
      const cronExpr = args.cron_expression as string | undefined;
      const delayMin = args.delay_minutes as number | undefined;

      if (!cronExpr && !delayMin) {
        return { error: '请提供 cron_expression（周期任务）或 delay_minutes（一次性延迟）' };
      }

      let finalCron: string;
      let isOneShot = false;
      if (delayMin && delayMin > 0) {
        // Convert delay_minutes to a one-shot cron at the target time
        const target = new Date(Date.now() + delayMin * 60 * 1000);
        finalCron = `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
        isOneShot = true;
      } else {
        finalCron = cronExpr!;
      }

      const id = generateCronJobId();
      // Optimize the stored prompt so it produces better results when triggered
      let finalPrompt = args.prompt as string;
      if (options?.optimizePrompt) {
        try {
          finalPrompt = await options.optimizePrompt(finalPrompt, finalCron);
        } catch (e) {
          logger.warn('Prompt optimization failed, using original: ' + (e as Error).message);
        }
      }
      // 从调用者的 ToolContext 自动捕获上下文
      const jobContext: CronJobContext | undefined = toolContext
        ? {
            platform: toolContext.platform,
            botId: toolContext.botId,
            senderId: toolContext.senderId,
            sceneId: toolContext.sceneId,
            scope: toolContext.scope,
          }
        : undefined;
      const job = await m.engine.addJob({
        id,
        cronExpression: finalCron,
        prompt: finalPrompt,
        label: args.label as string || (isOneShot ? `一次性提醒 (${delayMin}分钟后)` : undefined),
        enabled: true,
        context: jobContext,
      });

      if (isOneShot) {
        const target = new Date(Date.now() + (delayMin ?? 0) * 60 * 1000);
        const timeStr = target.toLocaleString('zh-CN', { hour12: false });
        return { success: true, id: job.id, message: `已安排一次性任务，将在 ${timeStr} 执行` };
      }
      return { success: true, id: job.id, message: '已添加周期性定时任务并立即生效' };
    });

  const removeTool = new ZhinTool('cron_remove')
    .desc('按 id 删除一条持久化定时任务')
    .keyword('删除定时', '取消定时', 'cron remove')
    .tag('cron', 'schedule')
    .param('id', { type: 'string', description: '任务 ID（cron_list 中 persistent 的 id）' }, true)
    .execute(async (args) => {
      const m = getCronManager();
      if (!m?.engine) {
        return { error: '持久化定时任务引擎不可用' };
      }
      const ok = await m.engine.removeJob(args.id as string);
      return ok ? { success: true, message: '已删除' } : { error: '未找到该任务' };
    });

  const pauseTool = new ZhinTool('cron_pause')
    .desc('暂停一条持久化定时任务（不删除，可 cron_resume 恢复）')
    .keyword('暂停定时', 'cron pause')
    .tag('cron', 'schedule')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getCronManager();
      if (!m?.engine) {
        return { error: '持久化定时任务引擎不可用' };
      }
      const ok = await m.engine.pauseJob(args.id as string);
      return ok ? { success: true, message: '已暂停' } : { error: '未找到该任务' };
    });

  const resumeTool = new ZhinTool('cron_resume')
    .desc('恢复已暂停的持久化定时任务')
    .keyword('恢复定时', 'cron resume')
    .tag('cron', 'schedule')
    .param('id', { type: 'string', description: '任务 ID' }, true)
    .execute(async (args) => {
      const m = getCronManager();
      if (!m?.engine) {
        return { error: '持久化定时任务引擎不可用' };
      }
      const ok = await m.engine.resumeJob(args.id as string);
      return ok ? { success: true, message: '已恢复' } : { error: '未找到该任务' };
    });

  return [listTool, addTool, removeTool, pauseTool, resumeTool];
}
