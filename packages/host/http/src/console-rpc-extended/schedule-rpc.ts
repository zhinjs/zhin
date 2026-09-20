import type { ConsoleRpcExtendedCtx, ConsoleScheduleEngine, ExtendedRpcResult, ScheduleJobRow } from './contracts.js';
import { errorMessage, strField } from './rpc-values.js';

const CRON_NOT_WIRED =
  '持久化调度未接线：当前 Plugin Runtime ScheduleHost 仅支持插件注册的内存任务（list），' +
  '不支持 add/remove/pause/resume（需要 @zhin.js/agent 持久化调度引擎）';

export function listSchedule(ctx: ConsoleScheduleListCtx): Promise<ExtendedRpcResult> | ExtendedRpcResult {
  const host = ctx.scheduleHost as { list?: () => unknown } | undefined;
  if (!host || typeof host.list !== 'function') {
    return { error: '调度服务未配置（scheduleHost 未挂载）' };
  }
  try {
    const raw = host.list();
    const memory: ScheduleJobRow[] = (Array.isArray(raw) ? raw : [])
      .filter((job): job is ScheduleJobRow =>
        !!job && typeof job === 'object'
        && typeof (job as ScheduleJobRow).id === 'string'
        && typeof (job as ScheduleJobRow).cron === 'string')
      .map((job) => ({
        id: job.id,
        cron: job.cron,
        ...(typeof job.description === 'string' ? { description: job.description } : {}),
        // console cron 页渲染字段（由 schedule host 提供时透传）
        expression: (job as { expression?: string }).expression ?? job.cron,
        running: (job as { running?: boolean }).running ?? true,
        ...((job as { plugin?: string }).plugin ? { plugin: (job as { plugin?: string }).plugin } : {}),
        ...((job as { nextExecution?: number }).nextExecution
          ? { nextExecution: (job as { nextExecution?: number }).nextExecution } : {}),
      }));
    return listPersistentJobs(ctx).then((persistent) => ({ data: { memory, persistent } }));
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

type ConsoleScheduleListCtx = ConsoleRpcExtendedCtx;

/** 持久化任务（Agent Host ScheduleJobEngine）→ 前端 PersistentCron 形状。 */
async function listPersistentJobs(ctx: ConsoleRpcExtendedCtx): Promise<Record<string, unknown>[]> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return [];
  try {
    const jobs = await engine.listJobs();
    return jobs.map((job) => ({
      id: job.id,
      label: job.label ?? job.id,
      cronExpression: (job.schedule as { cron?: string } | undefined)?.cron ?? '',
      prompt: (job.action as { prompt?: string } | undefined)?.prompt ?? '',
      enabled: job.enabled !== false,
      source: job.source ?? 'manual',
      createdAt: (job as { createdAt?: number }).createdAt,
      nextExecution: (job.state as { nextRunAtMs?: number } | undefined)?.nextRunAtMs,
      ...((job.notify as { target?: unknown } | undefined)?.target
        ? { context: { target: (job.notify as { target?: unknown }).target } } : {}),
      lastExecutedAt: (job.state as { lastExecutedAt?: number } | undefined)?.lastExecutedAt,
      lastStatus: (job.state as { lastStatus?: string } | undefined)?.lastStatus,
    }));
  } catch {
    return [];
  }
}

export async function addCron(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const cronExpression = String(d.cronExpression ?? '').trim();
  const prompt = String(d.prompt ?? '').trim();
  if (!cronExpression) return { error: 'cronExpression is required' };
  if (!prompt) return { error: 'prompt is required' };
  const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : undefined;
  const context = (d.context ?? {}) as Record<string, unknown>;
  const target = context.target ?? context.channel;
  const job = {
    id: `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...(label ? { label } : {}),
    enabled: true,
    schedule: { kind: 'solar', cron: cronExpression },
    action: { kind: 'agent', prompt },
    notify: target
      ? { channel: 'im', target }
      : { channel: 'silent' },
    source: 'manual',
  };
  try {
    const created = await engine.addJob(job);
    return { data: { job: created, success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function mutateCron(
  type: 'cron:remove' | 'cron:pause' | 'cron:resume',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const id = String(d.id ?? '').trim();
  if (!id) return { error: 'id is required' };
  try {
    const ok = type === 'cron:remove'
      ? await engine.removeJob(id)
      : type === 'cron:pause'
        ? await engine.pauseJob(id)
        : await engine.resumeJob(id);
    return ok ? { data: { success: true } } : { error: `任务不存在: ${id}` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- inbox
