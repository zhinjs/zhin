import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { redactStrings } from '../trace/turn-trace-archive.js';
import type { ScheduleAttemptIdentity, ScheduleHistoryEvent, ScheduleHistoryObserver, ScheduleHistoryProgress, ScheduleHistoryResult, ScheduleRunContext, ScheduleReplayDecision } from './execution-history.js';

export type ScheduleHistoryStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'budget_partial' | 'interrupted' | 'unsettled';
export interface ScheduleHistorySummary {
  readonly runId: string;
  readonly jobId: string;
  readonly label?: string;
  readonly source: ScheduleRunContext['source'];
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly status: ScheduleHistoryStatus;
  readonly attemptCount: number;
  readonly deliveryStatus?: NonNullable<ScheduleHistoryResult['delivery']>['status'];
  readonly recordingIssue?: boolean;
}
export interface ScheduleHistoryAttempt extends ScheduleAttemptIdentity {
  readonly finishedAt?: number;
  readonly result?: ScheduleHistoryResult;
  readonly progress: readonly ScheduleHistoryProgress[];
  readonly retry?: ScheduleReplayDecision;
}
/** One persisted run. Account/scene values are captured facts, never a latest-account lookup. */
export interface ScheduleHistoryRecord extends ScheduleHistorySummary {
  readonly version: 1;
  readonly ownerStartedAt: number;
  readonly scheduledAt?: number;
  readonly job: Readonly<Pick<ScheduleRunContext['job'], 'id' | 'label' | 'locale' | 'createdBy' | 'action' | 'notify'>>;
  readonly attempts: readonly ScheduleHistoryAttempt[];
  readonly result?: ScheduleHistoryResult;
}
export interface StoredScheduleHistorySummary extends ScheduleHistorySummary { readonly ownerStartedAt: number }
export interface ScheduleHistoryCursor { readonly queuedAt: number; readonly key: string }
export interface ScheduleHistoryQuery {
  readonly jobId?: string;
  readonly before?: ScheduleHistoryCursor;
  readonly limit: number;
}
export interface ScheduleHistoryHealth {
  readonly activeWriteFailures: number;
  readonly incompleteCompletedRuns: number;
  readonly lastFailureAt?: number;
  readonly lastRun?: Readonly<{ runId: string; jobId: string }>;
}
export interface ScheduleHistoryPage { readonly runs: readonly ScheduleHistorySummary[]; readonly nextCursor?: ScheduleHistoryCursor; readonly recordingHealth: ScheduleHistoryHealth }
export interface ScheduleHistoryRead { readonly runId: string; readonly jobId?: string }
export interface ScheduleHistoryCleanup { readonly deleted: number; readonly cutoff: number }
export interface ScheduleHistoryRepository {
  save(record: ScheduleHistoryRecord): Promise<void>;
  page(query: ScheduleHistoryQuery): Promise<readonly StoredScheduleHistorySummary[]>;
  read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined>;
  prune(input: Readonly<{ cutoff: number; ownerStartedAt: number }>): Promise<number>;
}
/** Host-facing query/management projection; contains no execution or retry authority. */
export interface ScheduleExecutionHistoryPort {
  page(query: ScheduleHistoryQuery): Promise<ScheduleHistoryPage>;
  read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined>;
  cleanup(): Promise<ScheduleHistoryCleanup>;
  health(): ScheduleHistoryHealth;
}

export const historyKey = (runId: string): string => createHash('sha256').update(runId).digest('hex');
export function historySummary(record: ScheduleHistoryRecord): StoredScheduleHistorySummary {
  const { runId, jobId, label, source, queuedAt, startedAt, finishedAt, status, attemptCount, deliveryStatus, recordingIssue } = record;
  return { runId, jobId, label, source, queuedAt, startedAt, finishedAt, status, attemptCount, deliveryStatus, recordingIssue, ownerStartedAt: record.ownerStartedAt };
}
export function compareHistory(left: ScheduleHistorySummary, right: ScheduleHistorySummary): number {
  return right.queuedAt - left.queuedAt || historyKey(right.runId).localeCompare(historyKey(left.runId));
}
export function matchesHistory(row: ScheduleHistorySummary, query: ScheduleHistoryQuery): boolean {
  return (!query.jobId || row.jobId === query.jobId) && (!query.before || row.queuedAt < query.before.queuedAt
    || (row.queuedAt === query.before.queuedAt && historyKey(row.runId) < query.before.key));
}
/** UTC calendar month, with end-of-month clamping; never a fixed thirty-day duration. */
export function scheduleHistoryCutoff(now: number): number {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}
export function recoveredHistory(record: ScheduleHistoryRecord, ownerStartedAt: number): ScheduleHistoryRecord {
  return record.finishedAt === undefined ? { ...record, status: record.ownerStartedAt !== ownerStartedAt ? 'interrupted' : 'unsettled' } : record;
}

function initialRecord(run: ScheduleRunContext, ownerStartedAt: number): ScheduleHistoryRecord {
  const { id, label, locale, createdBy, action, notify } = run.job;
  // HA payloads and arbitrary job/config extensions are not needed to explain a past run.
  const destination = notify.channel === 'ha' ? { channel: notify.channel, service: notify.service, target: notify.target } : notify;
  return { version: 1, ownerStartedAt, runId: run.runId, jobId: run.jobId, label, source: run.source,
    queuedAt: run.queuedAt, scheduledAt: run.scheduledAt, status: 'queued', attemptCount: 0,
    job: { id, label, locale, createdBy, action: { ...action, prompt: withoutInlineImages(action.prompt) }, notify: destination }, attempts: [] };
}
const withoutInlineImages = (text: string): string => text.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/giu, '[inline image omitted]');
function resultStatus(result: ScheduleHistoryResult): ScheduleHistoryStatus { return result.status ?? (result.success ? 'succeeded' : 'failed'); }
function savedResult(result: ScheduleHistoryResult): ScheduleHistoryResult {
  return { success: result.success, status: result.status, output: withoutInlineImages(result.output), error: result.error && withoutInlineImages(result.error),
    durationMs: result.durationMs, tokenUsage: { input: result.tokenUsage.input, output: result.tokenUsage.output },
    ...(result.replay ? { replay: { disposition: result.replay.disposition, operations: result.replay.operations.map(operation => ({
      id: operation.id, status: operation.status, toolName: operation.toolName,
    })) } } : {}),
    ...(result.delivery ? { delivery: { status: result.delivery.status, channel: result.delivery.channel,
      messages: result.delivery.messages, message: result.delivery.message, deliveryUnknown: result.delivery.deliveryUnknown } } : {}) };
}
type HistoryObservation = Readonly<{ type: 'run_queued'; record: ScheduleHistoryRecord }> | Exclude<ScheduleHistoryEvent, { type: 'run_queued' }>;
function historyObservation(event: ScheduleHistoryEvent, ownerStartedAt: number): HistoryObservation {
  if (event.type === 'run_queued') return { type: event.type, record: initialRecord(event.run, ownerStartedAt) };
  if (event.type === 'attempt_finished' || event.type === 'run_finished') return { ...event, result: savedResult(event.result) };
  return event;
}
function applyHistory(record: ScheduleHistoryRecord, event: Exclude<ScheduleHistoryEvent, { type: 'run_queued' }>): ScheduleHistoryRecord {
  if (record.jobId !== ('attempt' in event ? event.attempt.jobId : event.jobId)) throw new Error('Schedule history job identity mismatch');
  if (event.type === 'run_finished') {
    if (record.result && (record.finishedAt !== event.finishedAt || JSON.stringify(record.result) !== JSON.stringify(savedResult(event.result)))) throw new Error('Conflicting schedule run settlement');
    return { ...record, finishedAt: event.finishedAt, status: resultStatus(event.result), result: savedResult(event.result), deliveryStatus: event.result.delivery?.status };
  }
  const attemptId = 'attempt' in event ? event.attempt.attemptId : event.attemptId;
  const existing = record.attempts.find(attempt => attempt.attemptId === attemptId);
  if (event.type === 'attempt_started') {
    if (existing) {
      if (existing.runId !== event.attempt.runId || existing.jobId !== event.attempt.jobId
        || existing.number !== event.attempt.number || existing.startedAt !== event.attempt.startedAt) throw new Error('Conflicting schedule attempt identity');
      return record;
    }
    return { ...record, startedAt: record.startedAt ?? event.attempt.startedAt, status: 'running',
      attempts: [...record.attempts, { ...event.attempt, progress: [] }], attemptCount: record.attemptCount + 1 };
  }
  if (!existing) throw new Error('Schedule attempt was not recorded');
  if (event.type === 'attempt_replay') return { ...record, attempts: record.attempts.map(attempt => attempt === existing
    ? { ...attempt, retry: { decision: event.decision, reason: event.reason } } : attempt) };
  const updated = event.type === 'attempt_progress' ? { ...existing, progress: [...existing.progress, event] }
    : { ...existing, finishedAt: event.finishedAt, result: savedResult(event.result) };
  if (event.type === 'attempt_finished' && existing.result && (existing.finishedAt !== event.finishedAt || JSON.stringify(existing.result) !== JSON.stringify(savedResult(event.result)))) throw new Error('Conflicting schedule attempt settlement');
  return { ...record, attempts: record.attempts.map(attempt => attempt === existing ? updated : attempt) };
}

/** Serialized observational state. Write errors stay observable, but never erase business evidence. */
export class ScheduleExecutionHistory implements ScheduleHistoryObserver, ScheduleExecutionHistoryPort {
  #repository: ScheduleHistoryRepository;
  readonly #pending = new Map<string, ScheduleHistoryRecord>();
  readonly #writeFailures = new Set<string>();
  #incompleteCompletedRuns = 0;
  #lastFailureAt?: number;
  #lastFailedRun?: Readonly<{ runId: string; jobId: string }>;
  #tail: Promise<void> = Promise.resolve();
  readonly #now: () => number;
  readonly #ownerStartedAt: number;
  readonly #secrets: readonly string[];
  constructor(input: Readonly<{ repository: ScheduleHistoryRepository; now?: () => number; ownerStartedAt?: number; secrets?: readonly string[] }>) {
    this.#repository = input.repository;
    this.#now = input.now ?? Date.now;
    this.#ownerStartedAt = input.ownerStartedAt ?? Math.trunc(performance.timeOrigin);
    this.#secrets = input.secrets ?? [];
  }
  /** Called before scheduler publication; preserves the configured SQL/file mode. */
  activateRepository(repository: ScheduleHistoryRepository): void { this.#repository = repository; }
  observe(event: ScheduleHistoryEvent): Promise<void> {
    // TypeScript structural compatibility does not remove runtime audit/responseText/plan fields.
    // Project before cloning so the observation channel never retains those additional payloads.
    const snapshot = redactStrings(structuredClone(historyObservation(event, this.#ownerStartedAt)), this.#secrets);
    const operation = this.#tail.then(async () => {
      const runId = snapshot.type === 'run_queued' ? snapshot.record.runId : 'attempt' in snapshot ? snapshot.attempt.runId : snapshot.runId;
      const existing = this.#pending.get(runId);
      let record: ScheduleHistoryRecord;
      if (snapshot.type === 'run_queued') {
        if (existing) throw new Error('Schedule run identity already exists');
        record = snapshot.record;
      } else {
        const previous = existing ?? await this.#repository.read({ runId });
        if (!previous) throw new Error('Schedule run was not recorded');
        record = applyHistory(previous, snapshot);
      }
      this.#pending.set(runId, record);
      try {
        if (snapshot.type === 'run_queued' && await this.#repository.read({ runId })) throw new Error('Schedule run identity already exists');
        await this.#repository.save(record);
        this.#writeFailures.delete(runId);
        if (this.#lastFailedRun?.runId === runId) this.#lastFailedRun = undefined;
        if (record.finishedAt !== undefined) this.#pending.delete(runId);
      } catch (error) {
        this.#lastFailureAt = this.#now();
        this.#lastFailedRun = { runId: record.runId, jobId: record.jobId };
        if (record.finishedAt !== undefined) {
          // History is observational, not a memory-backed retry queue. Retain only health after
          // terminal write failure; the execution context has already fixed its business outcome.
          this.#incompleteCompletedRuns += 1;
          this.#pending.delete(runId);
          this.#writeFailures.delete(runId);
        } else this.#writeFailures.add(runId);
        throw error;
      }
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
  async page(query: ScheduleHistoryQuery): Promise<ScheduleHistoryPage> {
    await this.#tail;
    if (!Number.isSafeInteger(query.limit) || query.limit < 1) throw new TypeError('History limit must be a positive integer');
    const persisted = await this.#repository.page({ ...query, limit: query.limit + this.#writeFailures.size + 1 });
    const rows = new Map(persisted.map(({ ownerStartedAt, ...row }): [string, ScheduleHistorySummary] => {
      const active = this.#pending.get(row.runId);
      const status = active?.status ?? (row.finishedAt === undefined ? ownerStartedAt !== this.#ownerStartedAt ? 'interrupted' : 'unsettled' : row.status);
      return [row.runId, { ...row, status,
        ...(this.#incompleteCompletedRuns > 0 && this.#lastFailedRun?.runId === row.runId ? { recordingIssue: true } : {}) }];
    }));
    for (const runId of this.#writeFailures) {
      const pending = this.#pending.get(runId);
      if (pending && matchesHistory(pending, query)) rows.set(runId, { ...historySummary(pending), recordingIssue: true });
    }
    const sorted = [...rows.values()].sort(compareHistory);
    const runs = sorted.slice(0, query.limit);
    const last = runs.at(-1);
    return { runs, recordingHealth: this.health(), ...(sorted.length > query.limit && last ? { nextCursor: { queuedAt: last.queuedAt, key: historyKey(last.runId) } } : {}) };
  }
  async read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined> {
    await this.#tail;
    const pending = this.#pending.get(query.runId);
    if (pending && (!query.jobId || pending.jobId === query.jobId)) return { ...pending, ...(this.#writeFailures.has(query.runId) ? { recordingIssue: true } : {}) };
    const record = await this.#repository.read(query);
    return record ? { ...recoveredHistory(record, this.#ownerStartedAt),
      ...(this.#incompleteCompletedRuns > 0 && this.#lastFailedRun?.runId === record.runId ? { recordingIssue: true } : {}) } : undefined;
  }
  async cleanup(): Promise<ScheduleHistoryCleanup> {
    await this.#tail;
    const cutoff = scheduleHistoryCutoff(this.#now());
    const deleted = await this.#repository.prune({ cutoff, ownerStartedAt: this.#ownerStartedAt });
    for (const [runId, record] of this.#pending) {
      if (record.finishedAt !== undefined && record.queuedAt < cutoff) { this.#pending.delete(runId); this.#writeFailures.delete(runId); }
    }
    return { deleted, cutoff };
  }
  async drain(): Promise<void> { await this.#tail; }
  health(): ScheduleHistoryHealth {
    return { activeWriteFailures: this.#writeFailures.size, incompleteCompletedRuns: this.#incompleteCompletedRuns,
      lastFailureAt: this.#lastFailureAt, lastRun: this.#lastFailedRun };
  }
}
