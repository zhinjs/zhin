/**
 * TimerScheduler — persists timer definitions (schedule-jobs.json) and fires
 * them as `timer` Mail on the Actor Mailbox when due (ADR 0048 H3 PR-3).
 *
 * Replaces ScheduleJobEngine + JobWorker: the kernel ScheduleEngine remains
 * the clock; retries / dead-letter stay a projection over ScheduleExecutionQueue;
 * execution history is observed, not a new store.
 */
import { createMessages, resolveLocale } from '@zhin.js/plugin-runtime';
import { getLogger, formatCompact } from '@zhin.js/logger';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ScheduleEngine,
  getNextRun,
  isHeartbeatEmpty,
  resolveSolarJob,
  resolveLunarJob,
  resolveWorkdayJob,
  resolveFreeDayJob,
  resolveHolidayJob,
  resolveScatterJob,
  type ResolvedJob,
} from '@zhin.js/kernel';
import { ScheduleExecutionQueue, ScheduleQueueCancellation } from '../schedule-domain/schedule-execution-queue.js';
import { createScheduleAttempt, type ScheduleAttemptContext } from '../schedule-domain/attempt-context.js';
import { ScheduleAttemptFailure } from '../schedule-domain/execution-failure.js';
import { failedScheduleResult } from '../schedule-domain/execution-result.js';
import { ScheduleHistoryReporter } from '../schedule-domain/history-observer.js';
import type {
  ScheduleHistoryObserver,
  ScheduleObservationOwner,
  ScheduleRunContext,
} from '../schedule-domain/execution-history.js';
import type { TaskExecutionResult } from '../task-executor.js';
import type { ScheduleJobStore } from './job-store.js';
import type { ScheduleJob, JobSchedule } from './types.js';
import { DEFAULT_HEARTBEAT_PROMPT } from './profile-types.js';
import { type NotificationRouter, parseJobNotify, resolveEffectiveNotify } from './notification-router.js';
import { type AssistantQueueConfig, resolveAssistantQueueConfig } from './config.js';

const logger = getLogger('timer-scheduler');
const messages = createMessages({
  failed: { 'zh-CN': '[任务失败] {label}: {error}', en: '[Task failed] {label}: {error}' },
});

export type ScheduleDispose = () => void;

export function jobPrompt(job: ScheduleJob): string {
  if (job.action.kind === 'heartbeat' || job.action.kind === 'agent') {
    return job.executionPlan?.prompt?.trim() || job.action.prompt;
  }
  return '';
}

export function jobScheduleToResolved(schedule: JobSchedule, timezone = 'Asia/Shanghai'): ResolvedJob | null {
  const tz = 'tz' in schedule ? schedule.tz ?? timezone : timezone;
  switch (schedule.kind) {
    case 'solar':
      return resolveSolarJob(schedule.cron, tz);
    case 'lunar':
      return resolveLunarJob(schedule.cron, tz);
    case 'workday':
      return resolveWorkdayJob(schedule.cron, tz);
    case 'freeDay':
      return resolveFreeDayJob(schedule.cron, tz);
    case 'holiday':
      return resolveHolidayJob({
        cron: schedule.cron,
        festivals: schedule.festivals,
        everyDayOfHoliday: schedule.everyDayOfHoliday,
      }, tz);
    case 'scatter':
      return resolveScatterJob(schedule.input, tz);
    default:
      return null;
  }
}

export function isRuntimeSchedulable(job: ScheduleJob, now = Date.now()): boolean {
  if (!job.enabled) return false;
  switch (job.schedule.kind) {
    case 'solar':
    case 'lunar':
    case 'workday':
    case 'freeDay':
    case 'holiday':
      return Boolean(job.schedule.cron);
    case 'scatter':
      return Boolean(job.schedule.input);
    case 'every':
      return job.schedule.everyMs > 0;
    case 'at':
      return job.schedule.atMs > now;
    case 'event':
      return false;
    default:
      return false;
  }
}

export function registerJobSchedule(
  engine: ScheduleEngine,
  job: ScheduleJob,
  onRun: (jobId: string) => void | Promise<void>,
): ScheduleDispose | null {
  const jobId = job.id;
  try {
    const schedule = job.schedule;
    if (schedule.kind === 'every') {
      return engine.register(jobId, 'every', async () => {
        await onRun(jobId);
      }, { everyMs: schedule.everyMs });
    }
    if (schedule.kind === 'at') {
      return engine.register(jobId, 'at', async () => {
        await onRun(jobId);
      }, { atMs: schedule.atMs });
    }
    const resolved = jobScheduleToResolved(schedule);
    if (!resolved) return null;
    return engine.registerResolved(jobId, resolved, async () => {
      await onRun(jobId);
    });
  } catch (e: unknown) {
    logger.warn(`register failed for ${jobId}:`, (e as Error)?.message || String(e));
    return null;
  }
}

/** Runs one due timer as Mail (and its Actor turn). Owned by the host. */
export interface TimerDueHandler {
  run(
    job: ScheduleJob,
    options: Readonly<{
      source: ScheduleRunContext['source'];
      signal: AbortSignal;
      attempt: ScheduleAttemptContext;
      scheduledAt?: number;
    }>,
  ): Promise<TaskExecutionResult>;
}

export interface TimerSchedulerOptions {
  store: ScheduleJobStore;
  due: TimerDueHandler;
  /** Retry / concurrency defaults (internal; `assistant.queue` config is rejected at startup). */
  queue?: AssistantQueueConfig;
  history?: ScheduleHistoryObserver;
  observations?: ScheduleObservationOwner;
  notifyOnFailure?: boolean;
  router: NotificationRouter;
  defaultNotify?: import('./types.js').JobNotify;
  /** Workspace holding HEARTBEAT.md; a default-prompt heartbeat is skipped while that file has no task. */
  workspaceDir?: string;
}

/** An enabled job whose next run cannot be computed: it will never fire until fixed. */
export interface UnschedulableJob {
  readonly jobId: string;
  readonly label?: string;
  readonly reason: 'invalid_schedule' | 'no_next_run' | 'expired';
  readonly since: number;
}

export class TimerScheduler {
  readonly #scheduler = new ScheduleEngine();
  private store: ScheduleJobStore;
  private due: TimerDueHandler;
  private disposes = new Map<string, () => void>();
  readonly #unschedulable = new Map<string, UnschedulableJob>();
  private notifyOnFailure: boolean;
  private router: NotificationRouter;
  private defaultNotify?: import('./types.js').JobNotify;
  private workspaceDir?: string;
  private readonly queueCfg: ReturnType<typeof resolveAssistantQueueConfig>;
  private readonly queue: ScheduleExecutionQueue;
  readonly #history?: ScheduleHistoryObserver;
  readonly #observations?: ScheduleObservationOwner;

  constructor(options: TimerSchedulerOptions) {
    this.store = options.store;
    this.due = options.due;
    this.notifyOnFailure = options.notifyOnFailure === true;
    this.router = options.router;
    this.defaultNotify = options.defaultNotify;
    this.workspaceDir = options.workspaceDir;
    this.#history = options.history;
    this.#observations = options.observations;
    this.queueCfg = resolveAssistantQueueConfig(options.queue);
    this.queue = new ScheduleExecutionQueue({
      maxConcurrency: this.queueCfg.maxConcurrency,
      defaultMaxRetries: this.queueCfg.maxRetries,
      defaultTimeoutMs: this.queueCfg.defaultTimeoutMs,
    });
  }

  getDataDir(): string {
    return this.store.getDataDir();
  }

  async load(): Promise<void> {
    const jobs = await this.store.listJobs();
    for (const job of jobs) {
      if (isRuntimeSchedulable(job)) this.registerOne(job);
      // Self-heal: jobs written before the next run was persisted (or by a profile sync that reset
      // `state`) have no `nextRunAtMs`; recompute it for every job on start.
      await this.#syncNextRun(job, { repair: true });
    }
    const count = jobs.filter((j) => isRuntimeSchedulable(j)).length;
    if (count > 0) logger.debug(formatCompact({ schedule_jobs: count }));
  }

  registerOne(job: ScheduleJob): void {
    const prev = this.disposes.get(job.id);
    if (prev) {
      try { prev(); } catch { /* ignore */ }
      this.disposes.delete(job.id);
    }
    const dispose = registerJobSchedule(this.#scheduler, job, (jobId) => this.runJob(jobId));
    if (dispose) this.disposes.set(job.id, dispose);
  }

  /** Enabled jobs that cannot fire (no computable next run); the Console lists them as attention. */
  listUnschedulable(): readonly UnschedulableJob[] {
    return Object.freeze([...this.#unschedulable.values()]);
  }

  /** Next fire time of a registered job, or `undefined` when it will not fire. */
  nextRunAt(job: ScheduleJob, now = Date.now()): number | undefined {
    if (!job.enabled || !this.disposes.has(job.id)) return undefined;
    const schedule = job.schedule;
    if (schedule.kind === 'at') return schedule.atMs > now ? schedule.atMs : undefined;
    if (schedule.kind === 'every' || schedule.kind === 'scatter') {
      const next = this.#scheduler.getStatus().find(row => row.id === job.id)?.nextExecution;
      return next ? next.getTime() : undefined;
    }
    try {
      const resolved = jobScheduleToResolved(schedule);
      let next = resolved ? getNextRun(resolved, new Date(now)) : null;
      // Asked while the current fire is running: report the one after it.
      if (resolved && next && next.getTime() <= now) next = getNextRun(resolved, new Date(now + 1000));
      return next ? next.getTime() : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Persists `state.nextRunAtMs` (Console 「下次运行」) and tracks enabled jobs that cannot fire.
   * `repair` logs the start-up self-heal of a job that had no next run recorded.
   */
  async #syncNextRun(job: ScheduleJob, options: Readonly<{ repair?: boolean }> = {}): Promise<number | undefined> {
    const next = this.#trackNextRun(job);
    if (job.state?.nextRunAtMs !== next) {
      if (options.repair && next !== undefined && job.state?.nextRunAtMs === undefined) {
        logger.info(formatCompact({ op: 'schedule_next_run_repaired', job: job.id, next: new Date(next).toISOString() }));
      }
      await this.store.updateJobState(job.id, { nextRunAtMs: next });
    }
    return next;
  }

  /** Computes the next run and records / clears the job as unschedulable (no store write). */
  #trackNextRun(job: ScheduleJob): number | undefined {
    const next = this.nextRunAt(job);
    // A one-shot job that already ran is done, not stuck.
    const finished = job.schedule.kind === 'at' && job.state?.lastExecutedAt !== undefined;
    if (job.enabled && job.schedule.kind !== 'event' && !finished && next === undefined) {
      const reason: UnschedulableJob['reason'] = job.schedule.kind === 'at' ? 'expired'
        : this.disposes.has(job.id) ? 'no_next_run' : 'invalid_schedule';
      if (this.#unschedulable.get(job.id)?.reason !== reason) {
        logger.warn(formatCompact({ op: 'schedule_job_unschedulable', job: job.id, kind: job.schedule.kind, reason }));
        this.#unschedulable.set(job.id, Object.freeze({
          jobId: job.id, ...(job.label ? { label: job.label } : {}), reason, since: Date.now(),
        }));
      }
    } else {
      this.#unschedulable.delete(job.id);
    }
    return next;
  }

  /**
   * Run one job through the retry / dead-letter queue without touching the store
   * (tests and one-shot callers). Production due timers go through {@link runJobNow}.
   */
  async deliver(
    job: ScheduleJob,
    options: Readonly<{ source?: ScheduleRunContext['source']; scheduledAt?: number }> = {},
  ): Promise<TaskExecutionResult> {
    return this.#deliverWithRetries(structuredClone(job), {
      source: options.source ?? 'manual',
      ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }),
    });
  }

  async runJobNow(jobId: string, options: Readonly<{ source?: 'manual' | 'event' }> = {}): Promise<void> {
    await this.runJob(jobId, options.source ?? 'manual');
  }

  private async runJob(jobId: string, source: 'scheduled' | 'manual' | 'event' = 'scheduled'): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job || !job.enabled) return;
    if (job.action.kind !== 'agent' && job.action.kind !== 'heartbeat') return;
    if (await this.isIdleHeartbeat(job)) {
      logger.debug(formatCompact({ op: 'heartbeat_skipped', job: jobId, reason: 'no_heartbeat_tasks' }));
      return;
    }

    const result = await this.#deliverWithRetries(job, {
      source,
      ...(job.schedule.kind === 'at' ? { scheduledAt: job.schedule.atMs } : {}),
    });

    const lastExecutedAt = Date.now();
    // The next run is recorded with the outcome, in the same write (#1250).
    // Paused or removed while it ran: no longer registered, so no next run.
    const nextRunAtMs = this.#trackNextRun({ ...job, enabled: job.enabled && this.disposes.has(jobId), state: { ...job.state, lastExecutedAt } });
    await this.store.updateJobState(jobId, {
      lastExecutedAt,
      lastStatus: result.success ? 'ok' : 'error',
      lastError: result.success ? undefined : result.error,
      nextRunAtMs,
    });

    if (!result.success && (job.notifyOnFailure ?? this.notifyOnFailure)) {
      const notify = resolveEffectiveNotify(job.notify, this.defaultNotify);
      if (notify.channel !== 'silent' && notify.channel !== 'log') {
        const msg = messages(job.locale, 'failed', { label: job.label || jobId, error: result.error || 'unknown error' });
        await this.router.deliver({
          notify, content: msg, jobId, label: job.label, locale: resolveLocale(job.locale),
        }).catch(() => {});
      }
    }

    if (result.success && job.schedule.kind === 'at' && job.schedule.deleteAfterRun) {
      await this.removeJob(jobId);
    }
  }

  async #deliverWithRetries(
    job: ScheduleJob,
    options: Readonly<{ source: ScheduleRunContext['source']; scheduledAt?: number }>,
  ): Promise<TaskExecutionResult> {
    const label = job.label || job.id;
    const run: ScheduleRunContext = {
      runId: randomUUID(),
      jobId: job.id,
      queuedAt: Date.now(),
      source: options.source,
      job: structuredClone(job),
      ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }),
    };
    const history = new ScheduleHistoryReporter(this.#history, this.#observations);
    void history.observe({ type: 'run_queued', run });
    const finish = (result: TaskExecutionResult) => {
      history.observe({ type: 'run_finished', runId: run.runId, jobId: job.id, finishedAt: Date.now(), result });
      return result;
    };
    let number = 0;
    let attempt: ScheduleAttemptContext | undefined;
    let lastResult: TaskExecutionResult | undefined;
    try {
      const result = await this.queue.enqueueAndWait({
        name: label,
        maxRetries: this.queueCfg.maxRetries,
        timeoutMs: this.queueCfg.defaultTimeoutMs,
        canRetry: error => error instanceof ScheduleAttemptFailure && error.replay.disposition === 'safe',
        onRetryDecision: decision => {
          if (!attempt) return;
          const replay = lastResult?.replay ?? attempt.evidence.snapshot();
          void history.observe({
            type: 'attempt_replay', runId: run.runId, jobId: job.id,
            attemptId: attempt.identity.attemptId, decision: decision.retry ? 'retry' : 'stop',
            reason: decision.retry ? replay.reason ?? 'not_submitted'
              : decision.reason === 'not_retryable' ? replay.disposition === 'safe' ? 'not_retryable' : replay.disposition
                : decision.reason,
          });
        },
        execute: async signal => {
          attempt = createScheduleAttempt({ run, number: ++number, history });
          void history.observe({ type: 'attempt_started', attempt: attempt.identity });
          let result: TaskExecutionResult;
          let failure: unknown;
          try {
            result = await this.due.run(job, {
              source: options.source,
              signal,
              attempt,
              ...(options.scheduledAt === undefined ? {} : { scheduledAt: options.scheduledAt }),
            });
          } catch (cause) {
            failure = cause;
            result = cause instanceof ScheduleAttemptFailure && cause.result ? cause.result
              : {
                  ...failedScheduleResult({
                    job, cause, attempt, runId: run.runId,
                    startedAt: attempt.identity.startedAt, cancelled: signal.aborted,
                  }),
                  replay: cause instanceof ScheduleAttemptFailure
                    ? cause.replay
                    : { disposition: 'unknown', operations: [] },
                };
          }
          lastResult = result;
          void history.observe({ type: 'attempt_finished', attempt: attempt.identity, finishedAt: Date.now(), result });
          if (!result.success) {
            throw new ScheduleAttemptFailure({
              cause: failure ?? new Error(result.error || 'timer failed'),
              result,
              replay: result.replay ?? { disposition: 'unknown', operations: [] },
            });
          }
          return result;
        },
      });
      return finish(result);
    } catch (e: unknown) {
      const error = (e as Error)?.message || String(e);
      logger.warn(`Timer ${label} dead-letter: ${error}`);
      const result = e instanceof ScheduleAttemptFailure && e.result ? e.result : lastResult
        ?? failedScheduleResult({
          job, cause: e, attempt, runId: run.runId, startedAt: run.queuedAt,
          cancelled: e instanceof ScheduleQueueCancellation,
        });
      return finish(result);
    }
  }

  private async isIdleHeartbeat(job: ScheduleJob): Promise<boolean> {
    if (job.action.kind !== 'heartbeat' || !this.workspaceDir) return false;
    if (jobPrompt(job).trim() !== DEFAULT_HEARTBEAT_PROMPT) return false;
    const content = await readFile(join(this.workspaceDir, 'HEARTBEAT.md'), 'utf8').catch(() => null);
    return isHeartbeatEmpty(content);
  }

  async listJobs(): Promise<ScheduleJob[]> {
    return this.store.listJobs();
  }

  async addJob(job: Omit<ScheduleJob, 'createdAt' | 'updatedAt' | 'state'> & {
    createdAt?: number;
    updatedAt?: number;
    state?: ScheduleJob['state'];
  }): Promise<ScheduleJob> {
    const now = Date.now();
    const full: ScheduleJob = {
      ...job,
      createdAt: job.createdAt ?? now,
      updatedAt: job.updatedAt ?? now,
      state: job.state ?? {},
      enabled: job.enabled ?? true,
    };
    full.source = job.source ?? 'manual';
    // An `im` job must carry a complete target: storing one without would fail later (and in SQL
    // storage while encoding it), long after the caller got its answer.
    full.notify = parseJobNotify(resolveEffectiveNotify(full.notify, this.defaultNotify));
    await this.store.upsertJob(full);
    if (isRuntimeSchedulable(full)) this.registerOne(full);
    const next = await this.#syncNextRun(full);
    return { ...full, state: { ...full.state, nextRunAtMs: next } };
  }

  async removeJob(id: string): Promise<boolean> {
    const ok = await this.store.removeJob(id);
    if (!ok) return false;
    this.#unschedulable.delete(id);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  async pauseJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = false;
    job.state = { ...job.state, nextRunAtMs: undefined };
    await this.store.upsertJob(job);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    this.#unschedulable.delete(id);
    return true;
  }

  async resumeJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = true;
    await this.store.upsertJob(job);
    if (isRuntimeSchedulable(job)) this.registerOne(job);
    // Resume always recomputes the next run (the paused job had none).
    await this.#syncNextRun({ ...job, state: { ...job.state, nextRunAtMs: undefined } });
    return true;
  }

  async stop(): Promise<void> {
    await this.queue.dispose();
  }

  unload(): void {
    for (const [id, dispose] of this.disposes) {
      try { dispose(); } catch (e) { logger.warn(`Schedule dispose failed for ${id}:`, e); }
    }
    this.disposes.clear();
    this.#unschedulable.clear();
    this.#scheduler.dispose();
  }
}
