import { hostname } from 'node:os';
import { buildJobContext } from './context.js';
import { onHolidayDataUpdate } from './data/holiday-registry.js';
import { getNextRun } from './dispatch.js';
import {
  createJobId,
  resolveHandlerKey,
  toJobInfo,
  type InternalJob,
} from './job.js';
import {
  resolveHolidayJob,
  resolveFreeDayJob,
  resolveLunarJob,
  resolveScatterJob,
  resolveSolarJob,
  resolveWorkdayJob,
} from './resolve-job.js';
import { planScatterExecution } from './utils/scatter-misfire.js';
import {
  getScatterState,
  mergeScatterPayload,
} from './utils/scatter-state.js';
import {
  createHandlerRegistry,
  type HandlerRegistry,
  type RegisteredHandler,
} from './store/handler-registry.js';
import { createLocalJsonStore } from './store/local-json-store.js';
import { CURRENT_SCHEMA_VERSION } from './store/migrate.js';
import type { JobStore, StoredJob } from './store/types.js';
import { TimerWheel } from './timer/timer-wheel.js';
import type {
  HolidayInput,
  JobHandler,
  JobInfo,
  JobRegisterExtras,
  JobSnapshot,
  ResolvedJob,
  ScatterInput,
  SchedulerOptions,
} from './types.js';
import { DEFAULT_MISFIRE_GRACE_MS, DEFAULT_TIMEZONE } from './types.js';

const DEFAULT_RECONCILE_INTERVAL_MS = 1_000;
const DEFAULT_CLAIM_TTL_MS = 60_000;

function defaultWorkerId(): string {
  return `${hostname()}-${process.pid}`;
}

function parseExpiresAt(value: Date | string | undefined): Date | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toJobSnapshot(job: InternalJob): JobSnapshot {
  return {
    id: job.id,
    kind: job.resolved.kind,
    nextRunAt: job.nextRunAt,
    paused: job.paused,
    runCount: job.runCount,
    maxRuns: job.maxRuns,
    expiresAt: job.expiresAt ?? null,
    handlerKey: job.handlerKey,
    payload: job.payload,
    cancelled: job.cancelled,
  };
}

export class CalendarScheduler {
  private readonly timezone: string;
  private readonly onError?: SchedulerOptions['onError'];
  private readonly onJob?: SchedulerOptions['onJob'];
  private readonly store?: JobStore;
  readonly handlers: HandlerRegistry;
  private readonly reconcileIntervalMs: number;
  private readonly handlerTimeoutMs?: number;
  private readonly misfireGraceMs: number;
  private readonly workerId: string;
  private readonly jobs = new Map<string, InternalJob>();
  private readonly timer: TimerWheel;
  private running = true;
  private started = false;
  private startPromise: Promise<void> | null = null;
  readonly ready: Promise<void>;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private readonly executing = new Set<string>();
  private readonly unsubscribeHolidayUpdate: () => void;

  constructor(options: SchedulerOptions = {}) {
    this.timezone = options.timezone ?? DEFAULT_TIMEZONE;
    this.onError = options.onError;
    this.onJob = options.onJob;
    this.handlers = createHandlerRegistry(options.handlers);
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.handlerTimeoutMs = options.handlerTimeoutMs;
    this.misfireGraceMs = options.misfireGraceMs ?? DEFAULT_MISFIRE_GRACE_MS;
    this.workerId = options.workerId ?? defaultWorkerId();

    if (options.store) {
      this.store = options.store;
    } else if (options.storePath) {
      this.store = createLocalJsonStore({ path: options.storePath });
    }

    this.timer = new TimerWheel((job) => this.executeJob(job));
    this.unsubscribeHolidayUpdate = onHolidayDataUpdate(() => {
      void this.recalculateAllJobs();
    });

    if (this.store) {
      this.ready = this.start();
    } else {
      this.ready = Promise.resolve();
    }
  }

  /** 等价于 `new CalendarScheduler(options)` 后 `await scheduler.ready` */
  static async create(options: SchedulerOptions = {}): Promise<CalendarScheduler> {
    const scheduler = new CalendarScheduler(options);
    await scheduler.ready;
    return scheduler;
  }

  registerHandler(key: string, handler: RegisteredHandler): this {
    this.handlers.register(key, handler);
    return this;
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map(toJobSnapshot);
  }

  get(id: string): JobSnapshot | undefined {
    const job = this.jobs.get(id);
    return job ? toJobSnapshot(job) : undefined;
  }

  pause(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.cancelled || job.paused) {
      return false;
    }
    job.paused = true;
    this.timer.remove(id);
    if (this.store && !job.ephemeral) {
      void this.persistJob(job);
    }
    return true;
  }

  resume(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.cancelled || !job.paused) {
      return false;
    }
    job.paused = false;
    job.nextRunAt = getNextRun(job.resolved, new Date(), {
      jobId: job.id,
      scatterState:
        job.resolved.kind === 'scatter' ? getScatterState(job.payload) : undefined,
    });
    if (job.nextRunAt == null) {
      return this.cancel(id);
    }
    this.timer.add(job);
    if (this.store && !job.ephemeral) {
      void this.persistJob(job);
    }
    return true;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    if (this.store) {
      const stored = await this.store.load();
      for (const record of stored) {
        if (record.cancelled) {
          continue;
        }
        const job = this.fromStoredJob(record);
        this.jobs.set(job.id, job);
        if (!job.paused) {
          this.timer.add(job);
        }
      }
    }

    this.started = true;
    if (this.store) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcile();
      }, this.reconcileIntervalMs);
    }
  }

  solar(cron: string, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo {
    return this.register(resolveSolarJob(cron, this.timezone), handler, key, extras);
  }

  lunar(cron: string, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo {
    return this.register(resolveLunarJob(cron, this.timezone), handler, key, extras);
  }

  holiday(cron: string, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo;
  holiday(input: HolidayInput, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo;
  holiday(
    input: string | HolidayInput,
    handler: JobHandler,
    key?: string,
    extras?: JobRegisterExtras,
  ): JobInfo {
    return this.register(
      resolveHolidayJob(typeof input === 'string' ? { cron: input } : input, this.timezone),
      handler,
      key,
      extras,
    );
  }

  freeDay(cron: string, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo {
    return this.register(resolveFreeDayJob(cron, this.timezone), handler, key, extras);
  }

  workday(cron: string, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo {
    return this.register(resolveWorkdayJob(cron, this.timezone), handler, key, extras);
  }

  scatter(input: ScatterInput, handler: JobHandler, key?: string, extras?: JobRegisterExtras): JobInfo {
    return this.register(resolveScatterJob(input, this.timezone), handler, key, extras);
  }

  /** 注册已解析任务（zhin 持久化恢复：handler 可选，走 onJob + payload） */
  registerResolved(
    resolved: ResolvedJob,
    handler?: JobHandler,
    extras?: JobRegisterExtras,
  ): JobInfo {
    const noop = handler ?? (() => {});
    return this.register(resolved, noop, extras?.id, extras);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.cancelled) {
      return false;
    }
    job.cancelled = true;
    job.nextRunAt = null;
    this.timer.remove(id);
    this.jobs.delete(id);
    if (this.store && !job.ephemeral) {
      void this.removePersistedJob(id);
    }
    return true;
  }

  stop(): void {
    this.running = false;
    this.unsubscribeHolidayUpdate();
    if (this.reconcileTimer != null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.timer.stop();
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      job.nextRunAt = null;
    }
    this.jobs.clear();
  }

  private register(
    resolved: ResolvedJob,
    handler: JobHandler,
    key?: string,
    extras?: JobRegisterExtras,
  ): JobInfo {
    if (!this.running) {
      throw new Error('Scheduler has been stopped');
    }

    const handlerKey = handler ? resolveHandlerKey(handler, key) : undefined;

    if (handlerKey && handler) {
      this.handlers.register(handlerKey, handler);
    }

    const id = extras?.id ?? createJobId();
    const scatterState = getScatterState(extras?.payload);
    const payload =
      resolved.kind === 'scatter'
        ? mergeScatterPayload(extras?.payload, scatterState)
        : extras?.payload;
    const nextRunAt = getNextRun(resolved, new Date(), {
      jobId: id,
      scatterState: resolved.kind === 'scatter' ? scatterState : undefined,
    });
    const canPersist = Boolean(this.store && (handlerKey || this.onJob));
    const ephemeral = !canPersist;

    const job: InternalJob = {
      id,
      resolved,
      handler: handlerKey ? undefined : handler,
      handlerKey,
      payload,
      nextRunAt,
      cancelled: false,
      ephemeral,
      paused: false,
      runCount: 0,
      maxRuns: extras?.maxRuns,
      expiresAt: parseExpiresAt(extras?.expiresAt),
    };

    this.jobs.set(id, job);
    this.timer.add(job);

    if (this.store && canPersist) {
      void this.persistJob(job);
    }

    return toJobInfo(job, () => this.cancel(id));
  }

  private fromStoredJob(record: StoredJob): InternalJob {
    return {
      id: record.id,
      resolved: record.resolved,
      handlerKey: record.handlerKey,
      payload: record.payload,
      nextRunAt: record.nextRunAt ? new Date(record.nextRunAt) : null,
      cancelled: record.cancelled,
      ephemeral: false,
      paused: record.paused ?? false,
      runCount: record.runCount ?? 0,
      maxRuns: record.maxRuns,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    };
  }

  private toStoredJob(job: InternalJob): StoredJob {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: job.id,
      resolved: job.resolved,
      handlerKey: job.handlerKey ?? '',
      payload: job.payload,
      nextRunAt: job.nextRunAt?.toISOString() ?? null,
      cancelled: job.cancelled,
      updatedAt: new Date().toISOString(),
      paused: job.paused,
      runCount: job.runCount,
      maxRuns: job.maxRuns,
      expiresAt: job.expiresAt?.toISOString() ?? null,
    };
  }

  private async persistJob(job: InternalJob): Promise<void> {
    if (!this.store || job.ephemeral || !this.running) {
      return;
    }
    try {
      await this.store.upsert(this.toStoredJob(job));
    } catch {
      // persistence is best-effort (e.g. store path removed during shutdown)
    }
  }

  private async removePersistedJob(id: string): Promise<void> {
    if (!this.store) {
      return;
    }
    try {
      await this.store.remove(id);
    } catch {
      // persistence is best-effort (e.g. store path removed during shutdown)
    }
  }

  private jobExpired(job: InternalJob, now: Date): boolean {
    return job.expiresAt != null && now.getTime() >= job.expiresAt.getTime();
  }

  private async tryClaim(job: InternalJob): Promise<boolean> {
    if (!this.store?.claim) {
      return true;
    }
    return this.store.claim(job.id, this.workerId, DEFAULT_CLAIM_TTL_MS);
  }

  private async releaseClaim(job: InternalJob): Promise<void> {
    if (!this.store?.release) {
      return;
    }
    try {
      await this.store.release(job.id, this.workerId);
    } catch {
      // best-effort
    }
  }

  private async runHandler(handler: JobHandler, ctx: ReturnType<typeof buildJobContext>): Promise<void> {
    if (!this.handlerTimeoutMs) {
      await handler(ctx);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(handler(ctx)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Handler timeout after ${this.handlerTimeoutMs}ms`)),
            this.handlerTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async executeJob(job: InternalJob): Promise<void> {
    if (job.cancelled || !this.running || this.executing.has(job.id) || job.paused) {
      return;
    }

    const now = new Date();
    if (this.jobExpired(job, now)) {
      this.cancel(job.id);
      return;
    }

    const claimed = await this.tryClaim(job);
    if (!claimed) {
      return;
    }

    this.executing.add(job.id);
    this.timer.remove(job.id);

    try {
      let scheduledAt = job.nextRunAt ?? now;
      const scatterState = getScatterState(job.payload);
      let nextScatterState = scatterState;
      let scatterCtx:
        | {
            scatterIndex: number;
            scatterCount: number;
            scatterRemaining?: number;
            scatterSlotsToday?: Date[];
          }
        | undefined;

      if (job.resolved.kind === 'scatter') {
        const plan = planScatterExecution(
          job.resolved,
          job.id,
          scatterState,
          scheduledAt,
          now,
          this.misfireGraceMs,
        );
        scheduledAt = plan.scheduledAt;
        nextScatterState = plan.nextState;
        scatterCtx = {
          scatterIndex: plan.scatterIndex,
          scatterCount: plan.scatterCount,
          scatterRemaining: plan.scatterRemaining,
          scatterSlotsToday: plan.scatterSlotsToday,
        };

        if (!plan.shouldRunHandler) {
          job.payload = mergeScatterPayload(job.payload, nextScatterState);
          job.nextRunAt = getNextRun(job.resolved, new Date(), {
            jobId: job.id,
            scatterState: nextScatterState,
          });
          if (job.nextRunAt == null) {
            job.cancelled = true;
            this.jobs.delete(job.id);
            if (this.store && !job.ephemeral) {
              void this.removePersistedJob(job.id);
            }
            return;
          }
          if (this.store && !job.ephemeral) {
            await this.persistJob(job);
          }
          this.timer.update(job);
          return;
        }
      }

      const ctx = buildJobContext(
        job.id,
        job.resolved.kind,
        scheduledAt,
        job.resolved.timezone,
        scatterCtx,
      );
      const handler = this.resolveHandler(job);

      if (!handler) {
        if (this.onError) {
          this.onError(
            new Error(`Handler not found for key: ${job.handlerKey ?? '(inline)'}`),
            toJobInfo(job, () => this.cancel(job.id)),
          );
        }
      } else {
        try {
          await this.runHandler(handler, ctx);
          job.runCount++;
        } catch (err) {
          if (this.onError) {
            this.onError(
              err instanceof Error ? err : new Error(String(err)),
              toJobInfo(job, () => this.cancel(job.id)),
            );
          }
        }
      }

      if (job.cancelled || !this.running) {
        return;
      }

      if (job.maxRuns != null && job.runCount >= job.maxRuns) {
        this.cancel(job.id);
        return;
      }

      if (job.resolved.kind === 'scatter') {
        job.payload = mergeScatterPayload(job.payload, nextScatterState);
        job.nextRunAt = getNextRun(job.resolved, new Date(), {
          jobId: job.id,
          scatterState: nextScatterState,
        });
      } else {
        job.nextRunAt = getNextRun(job.resolved, new Date());
      }

      if (job.nextRunAt == null) {
        job.cancelled = true;
        this.jobs.delete(job.id);
        if (this.store && !job.ephemeral) {
          void this.removePersistedJob(job.id);
        }
        return;
      }

      if (this.store && !job.ephemeral) {
        await this.persistJob(job);
      }
      this.timer.update(job);
    } finally {
      this.executing.delete(job.id);
      await this.releaseClaim(job);
    }
  }

  private resolveHandler(job: InternalJob): JobHandler | undefined {
    if (job.handler) {
      return (ctx) => job.handler!(ctx);
    }
    if (job.handlerKey) {
      const registered = this.handlers.get(job.handlerKey);
      if (!registered) {
        return undefined;
      }
      return (ctx) => registered(ctx, job.payload);
    }
    if (this.onJob) {
      return (ctx) => this.onJob!(ctx, job.payload);
    }
    return undefined;
  }

  private async recalculateAllJobs(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.cancelled || job.paused) {
        continue;
      }
      job.nextRunAt = getNextRun(job.resolved, new Date(), {
        jobId: job.id,
        scatterState:
          job.resolved.kind === 'scatter' ? getScatterState(job.payload) : undefined,
      });
      if (job.nextRunAt == null) {
        job.cancelled = true;
        this.timer.remove(job.id);
        this.jobs.delete(job.id);
        if (this.store && !job.ephemeral) {
          await this.removePersistedJob(job.id);
        }
        continue;
      }
      this.timer.update(job);
      if (this.store && !job.ephemeral) {
        await this.persistJob(job);
      }
    }
  }

  private async reconcile(): Promise<void> {
    if (!this.store || !this.running) {
      return;
    }

    const dueRecords = await this.store.listDue(new Date());
    for (const record of dueRecords) {
      if (record.cancelled) {
        continue;
      }

      let job = this.jobs.get(record.id);
      if (!job) {
        job = this.fromStoredJob(record);
        this.jobs.set(job.id, job);
      }

      if (job.cancelled || job.nextRunAt == null || job.paused) {
        continue;
      }

      if (job.nextRunAt.getTime() > Date.now()) {
        this.timer.update(job);
        continue;
      }

      if (this.executing.has(job.id)) {
        continue;
      }

      await this.executeJob(job);
    }
  }
}
