import { createHash } from 'node:crypto';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { encodeStorageIdentity, decodeStorageIdentity, retryRelationalOperation } from '@zhin.js/plugin-runtime';
import type { ScheduleJob, ScheduleJobFile } from './types.js';

const text = { type: 'text', nullable: true } as const;
const time = { type: 'bigint', nullable: true } as const;
const flag = { type: 'boolean', nullable: true } as const;
export const SCHEDULE_JOB_MODEL = {
  id: { type: 'text', length: 64, primary: true }, job_id: { type: 'text', nullable: false }, position: { type: 'integer', nullable: false }, label: text, enabled: flag,
  created_at: time, updated_at: time, source: text, creator_id: text, creator_name: text, creator_roles_json: text,
  schedule_kind: text, cron: text, timezone: text, every_ms: time, at_ms: time, delete_after_run: flag,
  event_id: text, event_source: text, event_type: text, schedule_options_json: text,
  action_kind: text, prompt: text, agent: text,
  notify_channel: text, platform: text, endpoint_id: text, conversation_kind: text, conversation_id: text, sender_id: text,
  parent_kind: text, parent_id: text, thread_id: text, quote_id: text, ha_service: text, ha_target: text, ha_data_json: text,
  notify_on_failure: flag, activity_feedback: flag,
  last_executed_at: time, last_status: text, last_error: text, next_run_at: time, retry_count: { type: 'integer', nullable: true },
  plan_prompt: text, plan_tools_json: text, plan_skills_json: text, plan_preview: text, plan_previewed_at: time, plan_confirmed: flag,
  budget_json: text, event_payload_json: text,
};
export const SCHEDULE_JOB_MIGRATION_MODEL = { id: { type: 'integer', primary: true }, version: { type: 'integer', nullable: false } };
const jobKey = (id: string) => createHash('sha256').update(id).digest('hex');
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value);
const parse = (value: unknown) => value == null ? undefined : JSON.parse(String(value));
const encode = (value: string | undefined) => value === undefined ? null : encodeStorageIdentity(value);
const decode = (value: unknown) => value == null ? undefined : decodeStorageIdentity(value);

export function encodeScheduleJob(job: ScheduleJob, position: number): Record<string, unknown> {
  const schedule = job.schedule;
  const scene = job.notify.channel === 'im' ? job.notify.target.scene : undefined;
  const target = job.notify.channel === 'im' ? job.notify.target : undefined;
  return { id: jobKey(job.id), job_id: encodeStorageIdentity(job.id), position, label: encode(job.label), enabled: job.enabled,
    created_at: job.createdAt, updated_at: job.updatedAt, source: job.source ?? null,
    creator_id: encode(job.createdBy?.userId), creator_name: encode(job.createdBy?.name), creator_roles_json: json(job.createdBy?.roles),
    schedule_kind: schedule.kind, cron: 'cron' in schedule ? schedule.cron : null, timezone: 'tz' in schedule ? schedule.tz ?? null : null,
    every_ms: schedule.kind === 'every' ? schedule.everyMs : null, at_ms: schedule.kind === 'at' ? schedule.atMs : null,
    delete_after_run: schedule.kind === 'at' ? schedule.deleteAfterRun ?? null : null,
    event_id: schedule.kind === 'event' ? encode(schedule.eventId) : null,
    event_source: schedule.kind === 'event' ? encode(schedule.source) : null, event_type: schedule.kind === 'event' ? encode(schedule.eventType) : null,
    schedule_options_json: schedule.kind === 'scatter' ? json(schedule.input) : schedule.kind === 'holiday' ? json({ festivals: schedule.festivals, everyDayOfHoliday: schedule.everyDayOfHoliday }) : null,
    action_kind: job.action.kind, prompt: encode(job.action.prompt), agent: job.action.kind === 'agent' ? encode(job.action.agent) : null,
    notify_channel: job.notify.channel, platform: encode(scene?.platform), endpoint_id: encode(scene?.endpointKey), conversation_kind: scene?.kind ?? null,
    conversation_id: encode(scene?.sceneId), sender_id: encode(scene?.senderId), parent_kind: scene?.parent?.kind ?? null, parent_id: encode(scene?.parent?.sceneId),
    thread_id: encode(target?.threadId), quote_id: encode(target?.quoteId),
    ha_service: job.notify.channel === 'ha' ? encode(job.notify.service) : null, ha_target: job.notify.channel === 'ha' ? encode(job.notify.target) : null,
    ha_data_json: job.notify.channel === 'ha' ? json(job.notify.data) : null,
    notify_on_failure: job.notifyOnFailure ?? null, activity_feedback: job.activityFeedback ?? null,
    last_executed_at: job.state.lastExecutedAt ?? null, last_status: job.state.lastStatus ?? null, last_error: encode(job.state.lastError),
    next_run_at: job.state.nextRunAtMs ?? null, retry_count: job.state.retryCount ?? null,
    plan_prompt: encode(job.executionPlan?.prompt), plan_tools_json: json(job.executionPlan?.tools), plan_skills_json: json(job.executionPlan?.skills),
    plan_preview: encode(job.executionPlan?.previewSample), plan_previewed_at: job.executionPlan?.previewedAt ?? null, plan_confirmed: job.executionPlan?.confirmed ?? null,
    budget_json: json(job.budget), event_payload_json: json(job.eventPayload),
  };
}

export function decodeScheduleJob(row: Record<string, unknown>): ScheduleJob {
  const optional = (key: string, value: unknown) => value === undefined || value === null ? {} : { [key]: value };
  const number = (value: unknown) => value == null ? undefined : Number(value);
  const boolean = (value: unknown) => value == null ? undefined : Boolean(value);
  const schedule = { kind: row.schedule_kind,
    ...optional('cron', row.cron), ...optional('tz', row.timezone), ...optional('everyMs', number(row.every_ms)), ...optional('atMs', number(row.at_ms)),
    ...optional('deleteAfterRun', boolean(row.delete_after_run)), ...optional('eventId', decode(row.event_id)), ...optional('source', decode(row.event_source)), ...optional('eventType', decode(row.event_type)),
    ...(row.schedule_kind === 'scatter' ? { input: parse(row.schedule_options_json) } : row.schedule_kind === 'holiday' ? parse(row.schedule_options_json) : {}),
  } as ScheduleJob['schedule'];
  const notify = row.notify_channel === 'im' ? { channel: 'im', target: { channel: 'im', scene: {
    platform: decode(row.platform), endpointKey: decode(row.endpoint_id), sceneId: decode(row.conversation_id), kind: row.conversation_kind,
    ...optional('senderId', decode(row.sender_id)), ...(row.parent_kind == null ? {} : { parent: { kind: row.parent_kind, sceneId: decode(row.parent_id) } }),
  }, ...optional('threadId', decode(row.thread_id)), ...optional('quoteId', decode(row.quote_id)) } }
    : row.notify_channel === 'ha' ? { channel: 'ha', service: decode(row.ha_service), ...optional('target', decode(row.ha_target)), ...optional('data', parse(row.ha_data_json)) }
      : { channel: row.notify_channel };
  return { id: decodeStorageIdentity(row.job_id), ...optional('label', decode(row.label)), enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ...optional('source', row.source), schedule,
    action: { kind: row.action_kind, prompt: decode(row.prompt), ...optional('agent', decode(row.agent)) }, notify,
    ...optional('notifyOnFailure', boolean(row.notify_on_failure)), ...optional('activityFeedback', boolean(row.activity_feedback)),
    ...(row.creator_id == null ? {} : { createdBy: { userId: decode(row.creator_id), roles: parse(row.creator_roles_json), ...optional('name', decode(row.creator_name)) } }),
    state: { ...optional('lastExecutedAt', number(row.last_executed_at)), ...optional('lastStatus', row.last_status), ...optional('lastError', decode(row.last_error)),
      ...optional('nextRunAtMs', number(row.next_run_at)), ...optional('retryCount', number(row.retry_count)) },
    ...(row.plan_prompt == null ? {} : { executionPlan: { prompt: decode(row.plan_prompt), ...optional('tools', parse(row.plan_tools_json)), ...optional('skills', parse(row.plan_skills_json)),
      ...optional('previewSample', decode(row.plan_preview)), ...optional('previewedAt', number(row.plan_previewed_at)), ...optional('confirmed', boolean(row.plan_confirmed)) } }),
    ...optional('budget', parse(row.budget_json)), ...optional('eventPayload', parse(row.event_payload_json)),
  } as ScheduleJob;
}

/** Existing worker stays unchanged; mutations and first import use one DB transaction. */
export class DatabaseScheduleJobStorage {
  constructor(private readonly database: DatabaseHost) {}
  async activate(loadLegacy: () => Promise<ScheduleJobFile>): Promise<void> {
    await retryRelationalOperation(() => this.database.transaction!(async transaction => {
      const marker = transaction.model('agent_schedule_migration');
      if ((await marker.select().where({ id: 1 }))[0]) return;
      const file = await loadLegacy();
      if (file.version !== 1) throw new Error('Unsupported schedule-jobs file version');
      for (const [position, job] of file.jobs.entries()) await transaction.model('agent_schedule_jobs').insert(encodeScheduleJob(job, position));
      await marker.insert({ id: 1, version: file.version });
    }));
  }
  async read(): Promise<ScheduleJobFile> {
    const rows = await this.database.models.get('agent_schedule_jobs')!.select().orderBy('position');
    return { version: 1, jobs: rows.map(decodeScheduleJob) };
  }
  async get(id: string): Promise<ScheduleJob | undefined> {
    const row = (await this.database.models.get('agent_schedule_jobs')!.select().where({ id: jobKey(id) }).limit(1))[0];
    return row ? decodeScheduleJob(row) : undefined;
  }
  async mutateJob<T>(id: string, mutate: (job: ScheduleJob | undefined) => { job: ScheduleJob | undefined; result: T }): Promise<T> {
    return retryRelationalOperation(() => this.database.transaction!(async transaction => {
      await transaction.model('agent_schedule_migration').update({ version: 1 }).where({ id: 1 });
      const model = transaction.model('agent_schedule_jobs'), key = jobKey(id);
      const existing = (await model.select().where({ id: key }).limit(1))[0];
      const current = existing ? decodeScheduleJob(existing) : undefined;
      const { job, result } = mutate(current);
      if (job === current) return result;
      if (!job) { await model.delete().where({ id: key }); return result; }
      if (existing) await model.update(encodeScheduleJob(job, Number(existing.position))).where({ id: key });
      else {
        const last = (await model.select('position').orderBy('position', 'DESC').limit(1))[0];
        await model.insert(encodeScheduleJob(job, last ? Number(last.position) + 1 : 0));
      }
      return result;
    }));
  }
  async update<T>(mutate: (file: ScheduleJobFile) => T): Promise<T> {
    return retryRelationalOperation(() => this.database.transaction!(async transaction => {
      // Acquire a write lock before reading; separate Host processes cannot lose updates.
      await transaction.model('agent_schedule_migration').update({ version: 1 }).where({ id: 1 });
      const model = transaction.model('agent_schedule_jobs');
      const rows = await model.select().orderBy('position');
      const file = { version: 1, jobs: rows.map(decodeScheduleJob) };
      const result = mutate(file);
      await model.delete().where({});
      for (const [position, job] of file.jobs.entries()) await model.insert(encodeScheduleJob(job, position));
      return result;
    }));
  }
}
