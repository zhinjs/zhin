import { decodeStorageIdentity, encodeStorageIdentity, retryRelationalOperation, type DatabaseHost } from '@zhin.js/plugin-runtime';
import { createHash } from 'node:crypto';
import { historyKey, type ScheduleHistoryQuery, type ScheduleHistoryRead, type ScheduleHistoryRecord, type ScheduleHistoryRepository, type StoredScheduleHistorySummary } from './execution-history-store.js';

const text = { type: 'text', nullable: true } as const;
const time = { type: 'bigint', nullable: true } as const;
const json = { type: 'json', nullable: false } as const;
export const SCHEDULE_RUN_MODEL = {
  id: { type: 'text', length: 64, primary: true }, run_id: text, job_id: text, label: text,
  source: text, queued_at: time, started_at: time, finished_at: time, status: text,
  owner_started_at: time, attempt_count: { type: 'integer', nullable: false }, delivery_status: text,
  recording_issue: { type: 'boolean', nullable: false }, detail_json: json,
};
export const SCHEDULE_ATTEMPT_MODEL = {
  id: { type: 'text', length: 64, primary: true }, run_id: { type: 'text', length: 64, nullable: false },
  attempt_id: text, number: { type: 'integer', nullable: false }, started_at: time, finished_at: time, detail_json: json,
};
const attemptKey = (runId: string, attemptId: string): string => createHash('sha256').update(JSON.stringify([runId, attemptId])).digest('hex');
const value = (input: unknown): number | undefined => input === null || input === undefined ? undefined : Number(input);
const string = (input: unknown): string | undefined => input === null || input === undefined ? undefined : String(input);

/** Transactional history projection. The definition store remains separate and is never deleted here. */
export class DatabaseScheduleHistoryRepository implements ScheduleHistoryRepository {
  constructor(private readonly database: DatabaseHost) {
    if (!database.transaction) throw new Error('Schedule history requires transactional database storage');
  }
  async save(record: ScheduleHistoryRecord): Promise<void> {
    const { attempts, ...detail } = record;
    const id = historyKey(record.runId);
    const row = { id, run_id: encodeStorageIdentity(record.runId), job_id: encodeStorageIdentity(record.jobId), label: record.label ?? null,
      source: record.source, queued_at: record.queuedAt, started_at: record.startedAt ?? null, finished_at: record.finishedAt ?? null,
      status: record.status, owner_started_at: record.ownerStartedAt, attempt_count: record.attemptCount,
      delivery_status: record.deliveryStatus ?? null, recording_issue: record.recordingIssue === true, detail_json: detail };
    await retryRelationalOperation(() => this.database.transaction!(async transaction => {
      const runs = transaction.model('agent_schedule_runs');
      const existing = (await runs.select('run_id', 'job_id', 'queued_at').where({ id }).limit(1))[0];
      if (existing) {
        if (existing.run_id !== row.run_id || existing.job_id !== row.job_id || Number(existing.queued_at) !== record.queuedAt) throw new Error('Conflicting schedule run identity');
        await runs.update(row).where({ id });
      } else await runs.insert(row);
      const table = transaction.model('agent_schedule_attempts');
      for (const attempt of attempts) {
        const key = attemptKey(record.runId, attempt.attemptId);
        const entry = { id: key, run_id: id, attempt_id: encodeStorageIdentity(attempt.attemptId), number: attempt.number,
          started_at: attempt.startedAt, finished_at: attempt.finishedAt ?? null, detail_json: attempt };
        if ((await table.select('id').where({ id: key }).limit(1)).length) await table.update(entry).where({ id: key });
        else await table.insert(entry);
      }
    }));
  }
  async page(query: ScheduleHistoryQuery): Promise<readonly StoredScheduleHistorySummary[]> {
    const where = {
      ...(query.jobId ? { job_id: encodeStorageIdentity(query.jobId) } : {}),
      ...(query.before ? { $or: [{ queued_at: { $lt: query.before.queuedAt } }, { queued_at: query.before.queuedAt, id: { $lt: query.before.key } }] } : {}),
    };
    const rows = await this.database.models.get('agent_schedule_runs')!.select('run_id', 'job_id', 'label', 'source', 'queued_at', 'started_at',
      'finished_at', 'status', 'owner_started_at', 'attempt_count', 'delivery_status', 'recording_issue')
      .where(where).orderBy('queued_at', 'DESC').orderBy('id', 'DESC').limit(query.limit);
    return rows.map(row => ({ runId: decodeStorageIdentity(row.run_id), jobId: decodeStorageIdentity(row.job_id), label: string(row.label),
      source: row.source as StoredScheduleHistorySummary['source'], queuedAt: Number(row.queued_at), startedAt: value(row.started_at), finishedAt: value(row.finished_at),
      status: row.status as StoredScheduleHistorySummary['status'], ownerStartedAt: Number(row.owner_started_at), attemptCount: Number(row.attempt_count),
      deliveryStatus: string(row.delivery_status) as StoredScheduleHistorySummary['deliveryStatus'],
      ...(row.recording_issue === true || row.recording_issue === 1 ? { recordingIssue: true } : {}) }));
  }
  async read(query: ScheduleHistoryRead): Promise<ScheduleHistoryRecord | undefined> {
    const id = historyKey(query.runId);
    const row = (await this.database.models.get('agent_schedule_runs')!.select('run_id', 'job_id', 'detail_json').where({ id }).limit(1))[0];
    if (!row || (query.jobId && decodeStorageIdentity(row.job_id) !== query.jobId)) return undefined;
    if (decodeStorageIdentity(row.run_id) !== query.runId) throw new Error('Invalid schedule history identity');
    const detail = (typeof row.detail_json === 'string' ? JSON.parse(row.detail_json) : row.detail_json) as Omit<ScheduleHistoryRecord, 'attempts'>;
    const attempts = await this.database.models.get('agent_schedule_attempts')!.select('detail_json').where({ run_id: id }).orderBy('number');
    return { ...detail, attempts: attempts.map(attempt => typeof attempt.detail_json === 'string' ? JSON.parse(attempt.detail_json) : attempt.detail_json) };
  }
  async prune({ cutoff, ownerStartedAt, protectedRunIds }: Readonly<{ cutoff: number; ownerStartedAt: number; protectedRunIds: readonly string[] }>): Promise<number> {
    return retryRelationalOperation(() => this.database.transaction!(async transaction => {
      const runs = transaction.model('agent_schedule_runs');
      const protectedKeys = new Set(protectedRunIds.map(historyKey));
      const old = await runs.select('id', 'owner_started_at', 'finished_at').where({ queued_at: { $lt: cutoff } });
      const ids = old.filter(row => (row.finished_at !== null && row.finished_at !== undefined || Number(row.owner_started_at) !== ownerStartedAt)
        && !protectedKeys.has(String(row.id))).map(row => row.id);
      // Bounded SQL parameter batches; this is not a history capacity or retention limit.
      for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        await transaction.model('agent_schedule_attempts').delete().where({ run_id: { $in: batch } });
        await runs.delete().where({ id: { $in: batch } });
      }
      return ids.length;
    }));
  }
}
