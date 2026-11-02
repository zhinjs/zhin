import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { getLogger } from '@zhin.js/logger';
import { redactStrings } from '../trace/turn-trace-archive.js';
import { collectEnvironmentSecrets } from '../security/outbound-leak-guard.js';
import type { ScheduleAuditLogger, ScheduleAuditRecord } from './audit-logger.js';
import type { ScheduleActivityEvent, ScheduleActivityPort } from './activity.js';
import type { ScheduleAttemptIdentity, ScheduleHistoryEvent, ScheduleHistoryProgress, ScheduleHistoryResult, ScheduleRunContext, ScheduleReplayDecision, ScheduleObservationOwner } from './execution-history.js';

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
  prune(input: Readonly<{ cutoff: number; ownerStartedAt: number; protectedRunIds: readonly string[] }>): Promise<number>;
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

/** Unpersisted terminal observations share one approved generation-local budget. */
export const SCHEDULE_OBSERVATION_MAX_RUNS = 128;
export const SCHEDULE_OBSERVATION_MAX_BYTES = 16 * 1024 * 1024;

type AuxiliaryObservation = Readonly<{ kind: 'audit'; record: ScheduleAuditRecord }>
  | Readonly<{ kind: 'activity'; event: ScheduleActivityEvent }>;

export interface ScheduleExecutionHistoryOptions {
  /** Omit for audit/activity-only use; this does not enable durable execution history. */
  readonly repository?: ScheduleHistoryRepository;
  readonly now?: () => number;
  readonly ownerStartedAt?: number;
  /** Defaults to the existing environment-secret collector used by trace storage. */
  readonly secrets?: readonly string[];
  /** Both sinks run through this owner's single bounded physical writer. */
  readonly auditLogger?: ScheduleAuditLogger;
  readonly activity?: ScheduleActivityPort;
}

interface ObservationState {
  readonly runId: string;
  readonly jobId: string;
  record?: ScheduleHistoryRecord;
  auxiliary: readonly AuxiliaryObservation[];
  revision: number;
  dirty: boolean;
  firstWrite: boolean;
  incomplete: boolean;
  auxiliaryIncomplete: boolean;
  bytes?: number;
}
interface ObservationWrite {
  readonly state: ObservationState;
  readonly record?: ScheduleHistoryRecord;
  readonly auxiliary: readonly AuxiliaryObservation[];
  readonly revision: number;
  readonly bytes: number;
}
const terminalObservation = (state: ObservationState): boolean => !state.record || state.record.finishedAt !== undefined;
const observationBytes = (state: Pick<ObservationState, 'record' | 'auxiliary'>): number =>
  Buffer.byteLength(JSON.stringify({ record: state.record, auxiliary: state.auxiliary }), 'utf8');

/**
 * One observational owner, with synchronous acceptance and a single physical writer.
 * Active executions own their latest snapshot. Completed, unpersisted bodies are bounded;
 * failed/full records become constant health, never a business retry or an unbounded IO queue.
 */
export class ScheduleExecutionHistory implements ScheduleObservationOwner, ScheduleExecutionHistoryPort {
  #repository?: ScheduleHistoryRepository;
  readonly #pending = new Map<string, ObservationState>();
  readonly #writeFailures = new Set<string>();
  #incompleteCompletedRuns = 0;
  #lastFailureAt?: number;
  #lastFailedRun?: Readonly<{ runId: string; jobId: string }>;
  #writing?: ObservationWrite;
  #closed = false;
  #cleanup?: Promise<ScheduleHistoryCleanup>;
  #drained?: { promise: Promise<void>; resolve: () => void };
  readonly #now: () => number;
  readonly #ownerStartedAt: number;
  readonly #secrets: readonly string[];
  readonly #auditLogger?: ScheduleAuditLogger;
  readonly #activity?: ScheduleActivityPort;
  constructor(input: ScheduleExecutionHistoryOptions = {}) {
    this.#repository = input.repository;
    this.#now = input.now ?? Date.now;
    this.#ownerStartedAt = input.ownerStartedAt ?? Math.trunc(performance.timeOrigin);
    this.#secrets = input.secrets ?? collectEnvironmentSecrets();
    this.#auditLogger = input.auditLogger;
    this.#activity = input.activity;
  }
  /** Called before scheduler publication; preserves the configured SQL/file mode. */
  activateRepository(repository: ScheduleHistoryRepository): void { this.#repository = repository; }

  observe(event: ScheduleHistoryEvent): void {
    // Project before copying: structural types do not strip audit/responseText/plan fields.
    const snapshot = this.#redact(historyObservation(event, this.#ownerStartedAt));
    const runId = snapshot.type === 'run_queued' ? snapshot.record.runId : 'attempt' in snapshot ? snapshot.attempt.runId : snapshot.runId;
    const jobId = snapshot.type === 'run_queued' ? snapshot.record.jobId : 'attempt' in snapshot ? snapshot.attempt.jobId : snapshot.jobId;
    if (this.#closed) { this.#missing({ runId, jobId }); return; }
    const existing = this.#pending.get(runId);
    if (snapshot.type === 'run_queued') {
      if (existing) throw new Error('Schedule run identity already exists');
      this.#pending.set(runId, { runId, jobId, record: snapshot.record, auxiliary: [], revision: 1,
        dirty: true, firstWrite: true, incomplete: false, auxiliaryIncomplete: false });
    } else {
      if (!existing?.record) throw new Error('Schedule run was not recorded');
      existing.record = applyHistory(existing.record, snapshot);
      existing.revision++;
      existing.dirty = true;
      existing.bytes = undefined;
    }
    this.#admitAndWrite(runId);
  }

  audit({ attempt, record }: Parameters<ScheduleObservationOwner['audit']>[0]): void {
    // Keep the established JSONL fields only, never arbitrary runtime extensions.
    const { jobId, executionId, timestamp, createdBy, prompt, toolsResolved, toolsResolvedBy, skillsResolved,
      missingTools, missingSkills, toolsUsed, toolCallCount, tokenUsage, durationMs, budgetTerminated,
      securityDenials, success, outputLength, outputStripped, error } = record;
    const snapshot = this.#redact({ jobId, executionId, timestamp, createdBy, prompt, toolsResolved, toolsResolvedBy,
      skillsResolved, missingTools, missingSkills, toolsUsed, toolCallCount, tokenUsage, durationMs, budgetTerminated,
      securityDenials, success, outputLength, outputStripped, error });
    const state = this.#auxiliaryState(attempt);
    if (!state) return;
    state.auxiliary = [...state.auxiliary, { kind: 'audit', record: snapshot }];
    state.revision++; state.dirty = true; state.bytes = undefined;
    this.#admitAndWrite(attempt.runId);
  }

  activity({ attempt, event }: Parameters<ScheduleObservationOwner['activity']>[0]): void {
    const state = this.#auxiliaryState(attempt);
    if (!state) return;
    // Preserve the established callback payload and acceptance order; it shares the same byte budget.
    state.auxiliary = [...state.auxiliary, { kind: 'activity', event: this.#redact(event) }];
    state.revision++; state.dirty = true; state.bytes = undefined;
    this.#admitAndWrite(attempt.runId);
  }

  #redact<T>(value: T): T {
    // Reuse the trace credential scrubber, and omit image bytes in every observation string.
    return JSON.parse(JSON.stringify(redactStrings(value, this.#secrets), (_key, entry: unknown) =>
      typeof entry === 'string' ? withoutInlineImages(entry) : entry)) as T;
  }
  #auxiliaryState(attempt: ScheduleAttemptIdentity): ObservationState | undefined {
    if (this.#closed) { this.#missing(attempt); return; }
    let state = this.#pending.get(attempt.runId);
    if (!state) {
      state = { runId: attempt.runId, jobId: attempt.jobId, auxiliary: [], revision: 0,
        dirty: false, firstWrite: true, incomplete: false, auxiliaryIncomplete: false };
      this.#pending.set(attempt.runId, state);
    }
    if (state.jobId !== attempt.jobId) throw new Error('Schedule observation job identity mismatch');
    return state;
  }
  #missing(run: Readonly<{ runId: string; jobId: string }>): void {
    this.#incompleteCompletedRuns++;
    this.#lastFailureAt = this.#now();
    this.#lastFailedRun = { runId: run.runId, jobId: run.jobId };
  }
  #drop(state: ObservationState): void {
    this.#markIncomplete(state);
    if (this.#pending.get(state.runId) === state) {
      this.#pending.delete(state.runId);
      this.#writeFailures.delete(state.runId);
    }
    // An in-flight write retains only its already-issued immutable snapshot, not this newer body.
    state.record = undefined; state.auxiliary = []; state.dirty = false; state.bytes = undefined;
  }
  #markIncomplete(state: ObservationState): void {
    if (!state.incomplete) { state.incomplete = true; this.#missing(state); }
    if (state.record && !state.record.recordingIssue) {
      state.record = { ...state.record, recordingIssue: true }; state.bytes = undefined;
    }
  }
  #admitAndWrite(runId: string): void {
    const state = this.#pending.get(runId)!;
    if (terminalObservation(state)) {
      if (state.auxiliaryIncomplete) this.#markIncomplete(state);
      const { runs, bytes } = this.#reservation();
      if (runs.size > SCHEDULE_OBSERVATION_MAX_RUNS || bytes > SCHEDULE_OBSERVATION_MAX_BYTES) this.#drop(state);
    }
    this.#pump();
  }
  #reservation(): { runs: Set<string>; bytes: number } {
    const runs = new Set<string>();
    let bytes = 0;
    for (const state of this.#pending.values()) {
      if (terminalObservation(state)) { runs.add(state.runId); bytes += state.bytes ??= observationBytes(state); }
    }
    if (this.#writing) {
      const current = this.#pending.get(this.#writing.state.runId);
      runs.add(this.#writing.state.runId);
      // Reserve every physical in-flight body now, even while its execution is active:
      // that driver reference cannot be revoked when the run later becomes terminal.
      if (current !== this.#writing.state || !terminalObservation(current) || current.revision !== this.#writing.revision) bytes += this.#writing.bytes;
    }
    return { runs, bytes };
  }
  #pump(): void {
    if (this.#writing || this.#closed) return;
    const reserved = this.#reservation();
    const state = [...this.#pending.values()].find(candidate => {
      if (!candidate.dirty) return false;
      if (terminalObservation(candidate)) return true;
      // Keep a blocked active snapshot on its existing owner, not in a second IO queue.
      // A later observation or completed write can make room; no timer or busy retry.
      return reserved.runs.size < SCHEDULE_OBSERVATION_MAX_RUNS
        && reserved.bytes + (candidate.bytes ??= observationBytes(candidate)) <= SCHEDULE_OBSERVATION_MAX_BYTES;
    });
    if (!state) { this.#drained?.resolve(); this.#drained = undefined; return; }
    state.dirty = false;
    const write: ObservationWrite = { state, record: state.record, auxiliary: state.auxiliary,
      revision: state.revision, bytes: state.bytes ??= observationBytes(state) };
    this.#writing = write;
    void this.#persist(write);
  }
  async #persist(write: ObservationWrite): Promise<void> {
    const state = write.state;
    const attempted: AuxiliaryObservation[] = [];
    try {
      const repository = this.#repository;
      if (repository && write.record) {
        if (state.firstWrite) {
          if (await repository.read({ runId: state.runId })) throw new Error('Schedule run identity already exists');
          // Save may persist and then fail. The confirmed absence check still belongs to
          // this state, so its next new fact must not mistake that write for an external run.
          state.firstWrite = false;
        }
        await repository.save(write.record);
      }
      if (this.#closed) return;
      for (const fact of write.auxiliary) {
        attempted.push(fact);
        if (fact.kind === 'audit') await this.#auditLogger?.write(fact.record);
        else await this.#activity?.publish(fact.event);
        if (this.#closed) return;
      }
      if (!state.auxiliaryIncomplete) this.#writeFailures.delete(state.runId);
      if (this.#lastFailedRun?.runId === state.runId && !state.incomplete && !state.auxiliaryIncomplete) this.#lastFailedRun = undefined;
    } catch {
      if (attempted.length) state.auxiliaryIncomplete = true;
      this.#lastFailureAt = this.#now();
      this.#lastFailedRun = { runId: state.runId, jobId: state.jobId };
      if (terminalObservation(state)) {
        this.#drop(state);
      } else this.#writeFailures.add(state.runId);
    } finally {
      // Each captured auxiliary fact is attempted once. Newer facts remain on the same run,
      // not in a second Promise queue, and a later snapshot can repair an active history gap.
      state.auxiliary = state.auxiliary.filter(fact => !attempted.includes(fact));
      state.bytes = undefined;
      if (this.#pending.get(state.runId) === state && state.revision === write.revision && terminalObservation(state)) this.#pending.delete(state.runId);
      this.#writing = undefined;
      if (this.#closed) { this.#drained?.resolve(); this.#drained = undefined; }
      else this.#pump();
    }
  }

  async page(query: ScheduleHistoryQuery): Promise<ScheduleHistoryPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1) throw new TypeError('History limit must be a positive integer');
    const persisted = await this.#repository?.page({ ...query, limit: query.limit + this.#pending.size + 1 }) ?? [];
    const rows = new Map(persisted.map(({ ownerStartedAt, ...row }): [string, ScheduleHistorySummary] => {
      const pending = this.#pending.get(row.runId)?.record;
      const status = pending?.status ?? (row.finishedAt === undefined ? ownerStartedAt !== this.#ownerStartedAt ? 'interrupted' : 'unsettled' : row.status);
      return [row.runId, { ...row, status,
        ...(this.#incompleteCompletedRuns > 0 && this.#lastFailedRun?.runId === row.runId ? { recordingIssue: true } : {}) }];
    }));
    for (const state of this.#pending.values()) {
      const record = state.record;
      if (record && matchesHistory(record, query)) rows.set(state.runId, { ...historySummary(record),
        ...(this.#writeFailures.has(state.runId) ? { recordingIssue: true } : {}) });
    }
    const sorted = [...rows.values()].sort(compareHistory);
    const runs = sorted.slice(0, query.limit);
    const last = runs.at(-1);
    return { runs, recordingHealth: this.health(), ...(sorted.length > query.limit && last ? { nextCursor: { queuedAt: last.queuedAt, key: historyKey(last.runId) } } : {}) };
  }
  async read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined> {
    const pending = this.#pending.get(query.runId)?.record;
    if (pending && (!query.jobId || pending.jobId === query.jobId)) return { ...pending, ...(this.#writeFailures.has(query.runId) ? { recordingIssue: true } : {}) };
    const record = await this.#repository?.read(query);
    return record ? { ...recoveredHistory(record, this.#ownerStartedAt),
      ...(this.#incompleteCompletedRuns > 0 && this.#lastFailedRun?.runId === record.runId ? { recordingIssue: true } : {}) } : undefined;
  }
  cleanup(): Promise<ScheduleHistoryCleanup> {
    if (this.#closed) return Promise.reject(new Error('Schedule history owner is closed'));
    if (this.#cleanup) return this.#cleanup;
    const cutoff = scheduleHistoryCutoff(this.#now());
    const protectedRunIds = [...new Set([...this.#pending.keys(), ...(this.#writing ? [this.#writing.state.runId] : [])])];
    this.#cleanup = (async () => ({ deleted: await this.#repository?.prune({ cutoff, ownerStartedAt: this.#ownerStartedAt, protectedRunIds }) ?? 0, cutoff }))()
      .finally(() => { this.#cleanup = undefined; });
    return this.#cleanup;
  }
  /** Existing startup/hourly maintenance is observational, never a publication or shutdown dependency. */
  housekeeping(): void {
    if (this.#closed || this.#cleanup) return;
    void this.cleanup().catch(() => getLogger('schedule-history').warn('Schedule execution history cleanup failed'));
  }
  /** Explicit flush for tests/callers that choose to wait. Lifecycle shutdown uses close(), never drain(). */
  drain(): Promise<void> {
    if (!this.#writing) this.#pump();
    if (!this.#writing) return Promise.resolve();
    if (!this.#drained) {
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      this.#drained = { promise, resolve };
    }
    return this.#drained.promise;
  }
  /** Stops admission immediately. Already-issued driver IO cannot be cancelled by this owner. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#pending.values()) this.#drop(state);
    if (this.#writing && !this.#writing.state.incomplete) this.#drop(this.#writing.state);
    this.#drained?.resolve(); this.#drained = undefined;
  }
  health(): ScheduleHistoryHealth {
    return { activeWriteFailures: this.#writeFailures.size, incompleteCompletedRuns: this.#incompleteCompletedRuns,
      lastFailureAt: this.#lastFailureAt, lastRun: this.#lastFailedRun };
  }
}
