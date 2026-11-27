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
  redactSecretText,
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
import type { ScheduleJob, ScheduleJobState, ScheduleJobUpdate, JobSchedule } from './types.js';
import { DEFAULT_HEARTBEAT_PROMPT } from './profile-types.js';
import { ScheduleJobAgentError, profileJobAgentMessage } from './schedule-agent.js';
import { type DeliverResult, type NotificationRouter, parseJobNotify, resolveEffectiveNotify } from './notification-router.js';
import { type AssistantQueueConfig, resolveAssistantQueueConfig } from './config.js';
import { SCHEDULE_MODEL_RETRY_DELAYS_MS, scheduleModelFailureNotice } from './schedule-model-failure.js';

const logger = getLogger('timer-scheduler');
const messages = createMessages({
  failed: { 'zh-CN': '[任务失败] {label}: {error}', en: '[Task failed] {label}: {error}' },
  degraded: { 'zh-CN': '[任务未完成] {label}: {error}', en: '[Task not completed] {label}: {error}' },
});

export type ScheduleDispose = () => void;

/** `lastError` note of a run whose automatic retry after a transient model failure is pending (#1250 b40). */
function pendingModelRetryNote(retryInMs: number, attempt: number): string {
  return `；${Math.round(retryInMs / 60_000)} 分钟后自动重试（第 ${attempt}/${SCHEDULE_MODEL_RETRY_DELAYS_MS.length} 次）`;
}
const PENDING_MODEL_RETRY_NOTE = /；\d+ 分钟后自动重试（第 \d+\/\d+ 次）$/;

/**
 * `lastError` notes of a run whose failure notice did not certainly reach its target (#1250 b111):
 * it was not delivered, or the platform may have taken it but did not confirm it.
 */
const FAILURE_NOTICE_NOTES = { undelivered: '失败通知未送达', unconfirmed: '失败通知送达未确认' } as const;

/**
 * `lastError` with the failure-notice note, placed before a pending-retry note so that note stays
 * last (`withoutPendingModelRetry` looks for it at the end). A run without an error text (a degraded
 * run) gets the note alone.
 */
function withFailureNoticeNote(lastError: string | undefined, kind: keyof typeof FAILURE_NOTICE_NOTES, reason: string): string {
  const note = `${FAILURE_NOTICE_NOTES[kind]}（${reason}）`;
  const base = lastError ?? '';
  const pending = PENDING_MODEL_RETRY_NOTE.exec(base);
  const head = pending ? base.slice(0, pending.index) : base;
  return `${head ? `${head}；` : ''}${note}${pending ? pending[0] : ''}`;
}

/** A log-safe description of a notice target: routing kind and masked conversation id, no content. */
export function describeNotifyTarget(notify: ScheduleJob['notify']): string {
  if (notify.channel !== 'im') return notify.channel === 'ha' ? `ha:${notify.service}` : notify.channel;
  const scene = notify.target.scene;
  const id = scene.sceneId ? `${String(scene.sceneId).slice(0, 2)}***` : '-';
  return `im:${scene.platform || '-'}/${scene.endpointKey || '-'}/${scene.kind || '-'}:${id}`;
}

/** How a failure notice ended when it was not plainly sent (#1250 b111). */
export type FailureNoticeOutcome = Readonly<{
  /** `suppressed`: an outbound middleware held it back on purpose; `unconfirmed`: delivery unknown. */
  kind: 'undelivered' | 'unconfirmed' | 'suppressed';
  /** Why, redacted first and then bounded (a secret across the cut is not half kept). */
  reason: string;
}>;

/** How a failure notice ended, or `undefined` when it was delivered. */
export function failureNoticeOutcome(outcome: Readonly<{ result?: DeliverResult; error?: unknown }>): FailureNoticeOutcome | undefined {
  let reason: string;
  let kind: FailureNoticeOutcome['kind'] = 'undelivered';
  if (outcome.error !== undefined) {
    reason = outcome.error instanceof Error ? outcome.error.message || outcome.error.name : String(outcome.error);
  } else if (outcome.result && !outcome.result.delivered) {
    const receipt = outcome.result.receipt;
    if (receipt?.failure?.deliveryUnknown) kind = 'unconfirmed';
    else if (receipt?.status === 'suppressed') kind = 'suppressed';
    reason = receipt?.failure
      ? `${receipt.failure.code}: ${receipt.failure.message}`
      : receipt ? `status ${receipt.status}` : `not delivered (${outcome.result.channel})`;
  } else return undefined;
  const text = redactSecretText(reason.replace(/\s+/g, ' ').trim()) || 'unknown';
  return { kind, reason: text.length > 200 ? `${text.slice(0, 200)}…` : text };
}

/**
 * The stored state once a pending automatic retry will no longer run (the job was paused, or the
 * process restarted and the in-memory retry was lost): `lastError` must not keep promising it, and
 * `retryCount` counts only the retries that were made.
 */
function withoutPendingModelRetry<T extends ScheduleJobState | undefined>(state: T): T {
  const lastError = state?.lastError;
  if (!state || !lastError || !PENDING_MODEL_RETRY_NOTE.test(lastError)) return state;
  const made = Math.max(0, (state.retryCount ?? 1) - 1);
  return {
    ...state,
    lastError: lastError.replace(PENDING_MODEL_RETRY_NOTE,
      made > 0 ? `；已自动重试 ${made} 次，其余自动重试已取消` : '；自动重试已取消'),
    retryCount: made > 0 ? made : undefined,
  } as T;
}

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

/** Same timing (#1250 b90): stored schedules are plain JSON, so their serialization compares. */
function sameJobSchedule(a: JobSchedule, b: JobSchedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Throws when a calendar (cron) schedule cannot be evaluated, so `updateJob` never stores a job
 * that could not fire (#1250 b90). Other kinds are checked by their callers.
 */
function assertEvaluableSchedule(schedule: JobSchedule): void {
  if (!('cron' in schedule)) return;
  // `code: 'schedule_invalid'`: the Console routes answer it as a 400, not an internal error.
  const invalid = (message: string) => Object.assign(new Error(message), { code: 'schedule_invalid' as const });
  let resolved: ResolvedJob | null;
  try {
    resolved = jobScheduleToResolved(schedule);
    if (resolved) getNextRun(resolved, new Date());
  } catch (error) {
    throw invalid(`cron 表达式无效: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!resolved) throw invalid(`无法解析计划: ${schedule.kind}`);
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
  /** Pending automatic retries after a transient model failure (#1250 b40), by job id; in memory only. */
  readonly #modelRetries = new Map<string, () => void>();
  readonly #inFlight = new Set<Promise<void>>();
  /**
   * Per-job write lock (#1250 b90 review): `updateJob` / `removeJob` / `pauseJob` / `resumeJob` /
   * `setJobAgent` and the state writes that follow a run (re-read, outcome and next run, removing a
   * finished one-shot) run one at a time per job, so a change made while the run finishes is neither
   * overwritten by the old timing nor deleted with the one-shot it turned into a recurring job. The
   * run itself (the Agent turn) is not under the lock: a change made while it runs waits only for
   * those few store writes. The lock lives in this instance only: two schedulers sharing one store
   * are not serialised against each other (a runtime runs a single scheduler).
   */
  readonly #jobLocks = new Map<string, Promise<void>>();

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

  async #withJobLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#jobLocks.get(id) ?? Promise.resolve();
    const run = previous.then(fn);
    const settled = run.then(() => undefined, () => undefined);
    this.#jobLocks.set(id, settled);
    try {
      return await run;
    } finally {
      if (this.#jobLocks.get(id) === settled) this.#jobLocks.delete(id);
    }
  }

  getDataDir(): string {
    return this.store.getDataDir();
  }

  async load(): Promise<void> {
    const jobs = await this.store.listJobs();
    for (const job of jobs) {
      if (isRuntimeSchedulable(job)) this.registerOne(job);
      // #1250 b40: automatic retries live in memory only; one promised before a restart will not run.
      if (!this.#modelRetries.has(job.id)) {
        const state = withoutPendingModelRetry(job.state);
        if (state && state !== job.state) {
          await this.store.updateJobState(job.id, { lastError: state.lastError, retryCount: state.retryCount });
          job.state = state;
        }
      }
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

  /** Jobs with an automatic retry pending after a transient model failure (#1250 b40). */
  pendingModelRetries(): readonly string[] {
    return Object.freeze([...this.#modelRetries.keys()]);
  }

  #cancelModelRetry(jobId: string): void {
    const dispose = this.#modelRetries.get(jobId);
    if (!dispose) return;
    this.#modelRetries.delete(jobId);
    try { dispose(); } catch { /* ignore */ }
  }

  /**
   * @param retried automatic retries already made for this fire after transient model failures
   *   (#1250 b40); 0 for a regular fire.
   */
  private runJob(jobId: string, source: 'scheduled' | 'manual' | 'event' = 'scheduled', retried = 0): Promise<void> {
    // Tracked so `stop()` can wait for the state, delivery and history writes that follow the run.
    const run = this.#runJob(jobId, source, retried);
    this.#inFlight.add(run);
    const forget = () => { this.#inFlight.delete(run); };
    run.then(forget, forget);
    return run;
  }

  async #runJob(jobId: string, source: 'scheduled' | 'manual' | 'event', retried: number): Promise<void> {
    const job = await this.store.getJob(jobId);
    // A new fire (or a manual run) replaces a pending retry of the previous one.
    this.#cancelModelRetry(jobId);
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

    const modelFailure = result.success ? undefined : result.modelFailure;
    // The run's own state writes, under the job's lock (#1250 b90 review): a change made in between
    // waits for them, or is read by them, never half of each.
    const { retryInMs, lastExecutedAt: ranAt } = await this.#withJobLock(jobId, async () => {
      const lastExecutedAt = Date.now();
      // #1250 b90: the job may have been changed (`schedule_update`) while it ran; what follows the run
      // (its next run, an automatic retry, removing a finished one-shot) goes by the job as stored now,
      // not by the snapshot it ran with.
      const latest = await this.store.getJob(jobId);
      const current = latest ?? job;
      const rescheduled = latest !== undefined && !sameJobSchedule(latest.schedule, job.schedule);
      // #1250 b40: a run that failed because the model service was temporarily unavailable is retried
      // later (about 5, then 10 minutes) through this scheduler's clock, never by blocking. Only when
      // nothing it did can be repeated twice (no committed or unknown tool effect; a failed run sends
      // no reply) and the job is still scheduled, on the timing it ran with.
      const registered = current.enabled && this.disposes.has(jobId);
      const retryInMs = modelFailure?.transient && source === 'scheduled' && registered && !rescheduled
        && (result.replay?.disposition ?? 'safe') === 'safe'
        ? SCHEDULE_MODEL_RETRY_DELAYS_MS[retried] : undefined;
      const retryAt = retryInMs === undefined ? undefined : lastExecutedAt + retryInMs;
      // The next run is recorded with the outcome, in the same write (#1250).
      // Paused or removed while it ran: no longer registered, so no next run.
      const regularNext = this.#trackNextRun({ ...current, enabled: registered, state: { ...current.state, lastExecutedAt } });
      const nextRunAtMs = retryAt !== undefined && (regularNext === undefined || retryAt < regularNext) ? retryAt : regularNext;
      const lastError = !result.success || result.status === 'degraded'
        ? retryInMs !== undefined
          ? `${result.error ?? 'unknown error'}${pendingModelRetryNote(retryInMs, retried + 1)}`
          : modelFailure && retried > 0 ? `${result.error ?? 'unknown error'}；已自动重试 ${retried} 次，不再重试` : result.error
        : undefined;
      if (retryInMs !== undefined) {
        logger.warn(formatCompact({ op: 'schedule_model_retry', job: jobId, kind: modelFailure!.kind,
          attempt: retried + 1, in_ms: retryInMs }));
        try {
          const dispose = this.#scheduler.register(`${jobId}#model-retry`, 'at', async () => {
            this.#modelRetries.delete(jobId);
            await this.runJob(jobId, 'scheduled', retried + 1);
          }, { atMs: retryAt! });
          this.#modelRetries.set(jobId, dispose);
        } catch (error) {
          logger.warn(`model retry not scheduled for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await this.store.updateJobState(jobId, {
        lastExecutedAt,
        // #1250 b33: a run that finished without doing what was asked is `degraded`, with its cause.
        lastStatus: !result.success ? 'error' : result.status === 'degraded' ? 'degraded' : 'ok',
        lastError,
        nextRunAtMs,
        retryCount: retryInMs !== undefined ? retried + 1 : !result.success && retried > 0 ? retried : undefined,
      });
      // A one-shot job moved to another time or turned into a recurring one while it ran is kept.
      if (result.success && !rescheduled && current.schedule.kind === 'at' && current.schedule.deleteAfterRun) {
        await this.#removeJobUnlocked(jobId);
      }
      return { retryInMs, lastExecutedAt };
    });

    const degraded = result.success && result.status === 'degraded' ? result.degraded : undefined;
    // A degraded run whose delivered reply already is the fallback explanation is not announced twice.
    const alreadyExplained = degraded?.fallback === true && result.delivery?.status === 'delivered';
    const notifyFailures = job.notifyOnFailure ?? this.notifyOnFailure;
    const notify = resolveEffectiveNotify(job.notify, this.defaultNotify);
    const deliverable = notify.channel !== 'silent' && notify.channel !== 'log';
    if (modelFailure) {
      // #1250 b40 empty-reply-fallback-misleading: the recipient used to get the raw failure line
      // ("check your network") as the job's reply. They are told which job did not run and what
      // happens next: once retries are over (or none will be made), and on every failure when the
      // job asks to be told about failures.
      if (deliverable && (retryInMs === undefined || notifyFailures)) {
        const content = scheduleModelFailureNotice(job.locale, {
          label: job.label || jobId, failure: modelFailure, turnId: result.audit.executionId,
          ...(retryInMs !== undefined ? { retryInMs } : {}), retries: retried,
        });
        await this.#deliverFailureNotice(job, notify, content, ranAt);
      }
    } else if ((!result.success || (degraded && !alreadyExplained)) && notifyFailures) {
      if (deliverable) {
        const msg = messages(job.locale, degraded ? 'degraded' : 'failed', { label: job.label || jobId, error: result.error || 'unknown error' });
        await this.#deliverFailureNotice(job, notify, msg, ranAt);
      }
    }
  }

  /**
   * #1250 b111: a failure notice that cannot be delivered (thrown, or `delivered: false`), or whose
   * delivery is unconfirmed, is logged with the job, its target and why (redacted), and marked on
   * the run's `lastError`. One an outbound middleware suppressed on purpose is only logged at info.
   */
  async #deliverFailureNotice(job: ScheduleJob, notify: ScheduleJob['notify'], content: string, ranAt: number): Promise<void> {
    let outcome: { result?: DeliverResult; error?: unknown };
    try {
      outcome = { result: await this.router.deliver({ notify, content, jobId: job.id, label: job.label, locale: resolveLocale(job.locale) }) };
    } catch (error) {
      outcome = { error };
    }
    const ended = failureNoticeOutcome(outcome);
    if (ended === undefined) return;
    const fields = { job: job.id, target: describeNotifyTarget(notify), reason: ended.reason };
    if (ended.kind === 'suppressed') {
      // Held back on purpose by an outbound middleware: not a delivery failure, the run is not marked.
      logger.info(formatCompact({ op: 'schedule_failure_notice_suppressed', ...fields }));
      return;
    }
    logger.warn(formatCompact({ op: `schedule_failure_notice_${ended.kind}`, ...fields }));
    const kind = ended.kind;
    try {
      await this.#withJobLock(job.id, async () => {
        const current = await this.store.getJob(job.id);
        // Only the run that failed is marked: not a later run, nor a job removed meanwhile (a
        // one-shot job removed after its degraded run keeps only the log line).
        if (!current || current.state.lastExecutedAt !== ranAt) return;
        await this.store.updateJobState(job.id, { lastError: withFailureNoticeNote(current.state.lastError, kind, ended.reason) });
      });
    } catch (error) {
      logger.warn(`undelivered failure notice not recorded for ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
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
        // A failed model request was already retried by the provider layer; a transient one is retried
        // minutes later by `runJob` (#1250 b40), not again right away.
        canRetry: error => error instanceof ScheduleAttemptFailure && error.replay.disposition === 'safe'
          && !error.result?.modelFailure,
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
    // #1250: no default `source`. The deployer's paths (Console, CLI, Profile) set `manual` / `profile`
    // themselves, and only those count as the deployer's jobs (`recordCleanScheduledDelivery`): a job
    // added without one (a plugin calling `addJob`) must not pass for one. Readers treat absent as manual.
    // An `im` job must carry a complete target: storing one without would fail later (and in SQL
    // storage while encoding it), long after the caller got its answer.
    full.notify = parseJobNotify(resolveEffectiveNotify(full.notify, this.defaultNotify));
    await this.store.upsertJob(full);
    if (isRuntimeSchedulable(full)) this.registerOne(full);
    const next = await this.#syncNextRun(full);
    return { ...full, state: { ...full.state, nextRunAtMs: next } };
  }

  async removeJob(id: string): Promise<boolean> {
    return this.#withJobLock(id, () => this.#removeJobUnlocked(id));
  }

  async #removeJobUnlocked(id: string): Promise<boolean> {
    const ok = await this.store.removeJob(id);
    if (!ok) return false;
    this.#unschedulable.delete(id);
    this.#cancelModelRetry(id);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    return true;
  }

  async pauseJob(id: string): Promise<boolean> {
    return this.#withJobLock(id, () => this.#pauseJob(id));
  }

  async #pauseJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = false;
    // A pending automatic retry is dropped below (#1250 b40): the stored error no longer promises it.
    job.state = { ...withoutPendingModelRetry(job.state), nextRunAtMs: undefined };
    await this.store.upsertJob(job);
    const dispose = this.disposes.get(id);
    if (dispose) {
      dispose();
      this.disposes.delete(id);
    }
    this.#unschedulable.delete(id);
    this.#cancelModelRetry(id);
    return true;
  }

  async resumeJob(id: string): Promise<boolean> {
    return this.#withJobLock(id, () => this.#resumeJob(id));
  }

  async #resumeJob(id: string): Promise<boolean> {
    const job = await this.store.getJob(id);
    if (!job) return false;
    job.enabled = true;
    await this.store.upsertJob(job);
    if (isRuntimeSchedulable(job)) this.registerOne(job);
    // Resume always recomputes the next run (the paused job had none).
    await this.#syncNextRun({ ...job, state: { ...job.state, nextRunAtMs: undefined } });
    return true;
  }

  /**
   * Changes a job in place (#1250 b90): its schedule, label and whether it is enabled; every other
   * field (Agent, prompt, delivery, creator, plan) stays as stored. `null`: no such job. The job is
   * re-registered with its new timing and its next run recomputed; disabling it works like
   * `pauseJob`. Callers refuse profile routines (re-declared from the Profile on every start).
   */
  async updateJob(id: string, update: ScheduleJobUpdate): Promise<ScheduleJob | null> {
    // An invalid cron is refused before anything changes: the job keeps its timer and timing.
    if (update.schedule) assertEvaluableSchedule(update.schedule);
    return this.#withJobLock(id, () => this.#updateJob(id, update));
  }

  async #updateJob(id: string, update: ScheduleJobUpdate): Promise<ScheduleJob | null> {
    const job = await this.store.getJob(id);
    if (!job) return null;
    const wasEnabled = job.enabled;
    if (update.schedule) job.schedule = update.schedule;
    if (update.label === null) delete job.label;
    else if (update.label !== undefined) job.label = update.label;
    if (update.enabled !== undefined) job.enabled = update.enabled;
    job.updatedAt = Date.now();
    // Only a new timing or a changed enabled state re-registers the timer: a label change alone keeps
    // an `every` / `scatter` interval where it is.
    const retime = update.schedule !== undefined || job.enabled !== wasEnabled;
    if (retime) {
      const dispose = this.disposes.get(id);
      if (dispose) {
        dispose();
        this.disposes.delete(id);
      }
    }
    // A pending automatic retry belongs to the old timing (#1250 b40).
    if (update.schedule || !job.enabled) {
      this.#cancelModelRetry(id);
      job.state = { ...withoutPendingModelRetry(job.state), nextRunAtMs: undefined };
    }
    await this.store.upsertJob(job);
    if (retime && isRuntimeSchedulable(job)) this.registerOne(job);
    const next = await this.#syncNextRun(job);
    return { ...job, state: { ...job.state, nextRunAtMs: next } };
  }

  /**
   * Sets the Agent an `agent` job runs on, or clears it (`undefined`: back to the default `zhin`),
   * #1250 b52. The next run reads the stored job, so no re-registration is needed. `null`: no such
   * job. Throws {@link ScheduleJobAgentError} for a heartbeat job (always the default Agent) and for
   * a profile routine (re-declared from the Assistant Profile on every start: change it there).
   */
  async setJobAgent(id: string, agent: string | undefined): Promise<ScheduleJob | null> {
    return this.#withJobLock(id, () => this.#setJobAgent(id, agent));
  }

  async #setJobAgent(id: string, agent: string | undefined): Promise<ScheduleJob | null> {
    const job = await this.store.getJob(id);
    if (!job) return null;
    if (job.action.kind !== 'agent') throw new ScheduleJobAgentError('schedule_agent_heartbeat', `心跳任务不能指定 Agent: ${id}`);
    if (job.source === 'profile') throw new ScheduleJobAgentError('schedule_agent_profile', profileJobAgentMessage(id));
    const { agent: _previous, ...action } = job.action;
    job.action = agent ? { ...action, agent } : action;
    job.updatedAt = Date.now();
    await this.store.upsertJob(job);
    return job;
  }

  async stop(): Promise<void> {
    await this.queue.dispose();
    // A run keeps writing after its queue item settles (job state, delivery, history); wait for those
    // so nothing writes into a store or directory the caller is about to close or remove.
    await Promise.allSettled([...this.#inFlight]);
  }

  unload(): void {
    for (const [id, dispose] of this.disposes) {
      try { dispose(); } catch (e) { logger.warn(`Schedule dispose failed for ${id}:`, e); }
    }
    this.disposes.clear();
    for (const id of [...this.#modelRetries.keys()]) this.#cancelModelRetry(id);
    this.#unschedulable.clear();
    this.#scheduler.dispose();
  }
}
