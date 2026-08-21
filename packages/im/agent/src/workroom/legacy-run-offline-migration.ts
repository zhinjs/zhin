import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';

export type LegacyRunSourceFormat =
  | 'orchestration_repository_tables_v1'
  | 'orchestration_run_snapshot_v1';
export type LegacyRunStatus = 'open' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type LegacyRunMigrationStatus = 'migration_required' | 'historical_only';

export interface LegacyImportProvenance {
  readonly kind: 'legacy_import';
  readonly sourceFormat: LegacyRunSourceFormat;
  readonly recordRef: string;
  readonly recordDigest: string;
}

export interface LegacyRunInboxCandidate {
  readonly version: 1;
  readonly kind: 'inbox_candidate';
  readonly trust: 'untrusted';
  readonly objective: string;
  readonly provenance: LegacyImportProvenance;
}

export interface LegacyRunEvidenceCandidate {
  readonly version: 1;
  readonly kind: 'evidence_candidate';
  readonly trust: 'untrusted';
  readonly taskId: string;
  readonly legacyStatus: LegacyTaskStatus;
  readonly summary?: string;
  readonly error?: string;
  readonly provenance: LegacyImportProvenance;
}

export interface LegacyRunOfflineAudit {
  readonly version: 1;
  readonly legacyRunId: string;
  readonly legacyStatus: LegacyRunStatus;
  readonly migrationStatus: LegacyRunMigrationStatus;
  /** Legacy completion is execution history, never a Workroom Acceptance Record. */
  readonly accepted: false;
  readonly allowedActions: readonly ('export' | 'cancel_proposal' | 'replan_proposal')[];
  readonly provenance: LegacyImportProvenance;
  readonly audit: Readonly<{
    sessionKey: string;
    title: string;
    template?: string;
    taskCount: number;
    eventCount: number;
    createdAt: number;
    updatedAt: number;
  }>;
  readonly importCandidates: Readonly<{
    inbox: LegacyRunInboxCandidate;
    evidence: readonly LegacyRunEvidenceCandidate[];
  }>;
}

export interface LegacyRunOfflineReport {
  readonly version: 1;
  readonly kind: 'legacy_run_offline_audit';
  readonly sourceFormat: LegacyRunSourceFormat;
  readonly readOnly: true;
  readonly startsAgent: false;
  readonly writesNewJournal: false;
  readonly runs: readonly LegacyRunOfflineAudit[];
  readonly digest: string;
}

export type LegacyRunMigrationProposalAction = 'cancel' | 'replan';

export interface LegacyRunMigrationProposal {
  readonly version: 1;
  readonly kind: 'legacy_run_migration_proposal';
  readonly action: LegacyRunMigrationProposalAction;
  readonly authority: 'proposal_only';
  readonly legacyRunId: string;
  readonly sourceReportDigest: string;
  readonly targetProjectId?: string;
  readonly requiresExplicitNewKernelAdmission: true;
  readonly writesNewJournal: false;
  readonly candidates: LegacyRunOfflineAudit['importCandidates'];
  readonly provenance: LegacyImportProvenance;
  readonly digest: string;
}

interface LegacyRunRecord {
  readonly id: string;
  readonly sessionKey: string;
  readonly status: LegacyRunStatus;
  readonly title: string;
  readonly template?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type LegacyTaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'waiting_result'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface LegacyTaskRecord {
  readonly id: string;
  readonly runId: string;
  readonly name: string;
  readonly goal: string;
  readonly status: LegacyTaskStatus;
  readonly dependsOn: readonly string[];
  readonly resultSummary?: string;
  readonly error?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface LegacyEventRecord {
  readonly id: string;
  readonly runId: string;
  readonly taskId?: string;
  readonly type: LegacyEventType;
  readonly seq: number;
  readonly createdAt: number;
}

interface NormalizedLegacyExport {
  readonly sourceFormat: LegacyRunSourceFormat;
  readonly runs: readonly LegacyRunRecord[];
  readonly tasks: readonly LegacyTaskRecord[];
  readonly events: readonly LegacyEventRecord[];
}

const RUN_STATUSES = new Set<LegacyRunStatus>([
  'open', 'running', 'waiting', 'completed', 'failed', 'cancelled',
]);
const TASK_STATUSES = new Set<LegacyTaskStatus>([
  'pending', 'assigned', 'running', 'waiting_result', 'completed', 'failed', 'cancelled',
]);
const ROLES = new Set([
  'subtask', 'worker', 'researcher', 'evaluator', 'executor', 'reviewer', 'planner',
]);
const EVENT_TYPES = new Set<LegacyEventType>([
  'run.started', 'run.status_changed', 'task.created', 'task.assigned',
  'task.started', 'task.thinking', 'task.progress', 'task.completed',
  'task.failed', 'result.returned',
]);
type LegacyEventType =
  | 'run.started'
  | 'run.status_changed'
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.thinking'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'result.returned';

/** Pure offline parser/auditor. It has no Host, Agent, database, or Kernel dependency. */
export function buildLegacyRunOfflineReport(input: unknown): LegacyRunOfflineReport {
  const normalized = normalizeExport(input);
  assertReferences(normalized);
  const runs = normalized.runs
    .map(run => auditRun(normalized, run))
    .sort((left, right) => left.legacyRunId.localeCompare(right.legacyRunId));
  const body = deepFreeze({
    version: 1 as const,
    kind: 'legacy_run_offline_audit' as const,
    sourceFormat: normalized.sourceFormat,
    readOnly: true as const,
    startsAgent: false as const,
    writesNewJournal: false as const,
    runs,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export function createLegacyRunMigrationProposal(
  report: LegacyRunOfflineReport,
  input: Readonly<{
    legacyRunId: string;
    action: LegacyRunMigrationProposalAction;
    targetProjectId?: string;
  }>,
): LegacyRunMigrationProposal {
  assertReport(report);
  const runId = text(input.legacyRunId, 'legacy Run id');
  const run = report.runs.find(candidate => candidate.legacyRunId === runId);
  if (!run) throw new Error(`Legacy Run ${runId} is absent from the offline report`);
  if (run.migrationStatus !== 'migration_required') {
    throw new Error(`Legacy Run ${runId} is not migration_required`);
  }
  if (input.action !== 'cancel' && input.action !== 'replan') {
    throw new Error('Legacy Run migration proposal action is invalid');
  }
  const targetProjectId = input.action === 'replan'
    ? text(input.targetProjectId, 'target Project id')
    : undefined;
  const body = deepFreeze({
    version: 1 as const,
    kind: 'legacy_run_migration_proposal' as const,
    action: input.action,
    authority: 'proposal_only' as const,
    legacyRunId: runId,
    sourceReportDigest: report.digest,
    ...(targetProjectId === undefined ? {} : { targetProjectId }),
    requiresExplicitNewKernelAdmission: true as const,
    writesNewJournal: false as const,
    candidates: structuredClone(run.importCandidates),
    provenance: structuredClone(run.provenance),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function auditRun(
  input: NormalizedLegacyExport,
  run: LegacyRunRecord,
): LegacyRunOfflineAudit {
  const tasks = input.tasks.filter(task => task.runId === run.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const events = input.events.filter(event => event.runId === run.id)
    .sort((left, right) => left.seq - right.seq);
  const recordDigest = digest({ run, tasks, events });
  const provenance = deepFreeze<LegacyImportProvenance>({
    kind: 'legacy_import',
    sourceFormat: input.sourceFormat,
    recordRef: `legacy-orchestration-run:${encodeURIComponent(run.id)}`,
    recordDigest,
  });
  const migrationRequired = run.status === 'open'
    || run.status === 'running'
    || run.status === 'waiting';
  const evidence = tasks.flatMap(task => {
    if (!task.resultSummary && !task.error) return [];
    return [deepFreeze<LegacyRunEvidenceCandidate>({
      version: 1,
      kind: 'evidence_candidate',
      trust: 'untrusted',
      taskId: task.id,
      legacyStatus: task.status,
      ...(task.resultSummary ? { summary: task.resultSummary } : {}),
      ...(task.error ? { error: task.error } : {}),
      provenance,
    })];
  });
  return deepFreeze({
    version: 1,
    legacyRunId: run.id,
    legacyStatus: run.status,
    migrationStatus: migrationRequired ? 'migration_required' : 'historical_only',
    accepted: false,
    allowedActions: migrationRequired
      ? ['export', 'cancel_proposal', 'replan_proposal'] as const
      : ['export'] as const,
    provenance,
    audit: {
      sessionKey: run.sessionKey,
      title: run.title,
      ...(run.template ? { template: run.template } : {}),
      taskCount: tasks.length,
      eventCount: events.length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    importCandidates: {
      inbox: {
        version: 1,
        kind: 'inbox_candidate',
        trust: 'untrusted',
        objective: run.title || tasks.map(task => task.goal).filter(Boolean).join('; ') || `Legacy Run ${run.id}`,
        provenance,
      },
      evidence,
    },
  });
}

function normalizeExport(input: unknown): NormalizedLegacyExport {
  const value = record(input, 'legacy export');
  const keys = Object.keys(value).sort();
  if (sameKeys(keys, ['orchestration_events', 'orchestration_runs', 'orchestration_tasks'])) {
    const runs = array(value.orchestration_runs, 'legacy orchestration_runs')
      .map((row, index) => repositoryRun(row, index));
    const tasks = array(value.orchestration_tasks, 'legacy orchestration_tasks')
      .map((row, index) => repositoryTask(row, index));
    const events = array(value.orchestration_events, 'legacy orchestration_events')
      .map((row, index) => repositoryEvent(row, index));
    return deepFreeze({
      sourceFormat: 'orchestration_repository_tables_v1', runs, tasks, events,
    });
  }
  if (sameKeys(keys, ['events', 'run', 'tasks'])) {
    const run = snapshotRun(value.run);
    const tasks = array(value.tasks, 'legacy snapshot tasks').map(snapshotTask);
    const events = array(value.events, 'legacy snapshot events').map(snapshotEvent);
    return deepFreeze({
      sourceFormat: 'orchestration_run_snapshot_v1', runs: [run], tasks, events,
    });
  }
  throw new Error('Unknown legacy Run export schema');
}

function repositoryRun(value: unknown, index: number): LegacyRunRecord {
  const row = exactRecord(value, [
    'id', 'session_key', 'status', 'title', 'template', 'source_json', 'state_json',
    'state_version', 'created_at', 'updated_at',
  ], `legacy orchestration_runs[${index}]`);
  const source = jsonObject(row.source_json, `legacy Run ${index} source_json`, true);
  if (source) legacySource(source, `legacy Run ${index} source_json`);
  jsonObject(row.state_json, `legacy Run ${index} state_json`, true);
  if (row.state_version !== 0) throw new Error(`legacy Run ${index} state schema version is unknown`);
  return deepFreeze({
    id: text(row.id, `legacy Run ${index} id`),
    sessionKey: text(row.session_key, `legacy Run ${index} session_key`),
    status: runStatus(row.status),
    title: string(row.title, `legacy Run ${index} title`),
    ...(string(row.template, `legacy Run ${index} template`) ? { template: row.template as string } : {}),
    createdAt: nonNegativeInteger(row.created_at, `legacy Run ${index} created_at`),
    updatedAt: nonNegativeInteger(row.updated_at, `legacy Run ${index} updated_at`),
  });
}

function repositoryTask(value: unknown, index: number): LegacyTaskRecord {
  const label = `legacy orchestration_tasks[${index}]`;
  const row = exactRecord(value, [
    'id', 'run_id', 'name', 'description', 'role', 'goal', 'status', 'depends_on',
    'executor_kind', 'assigned_to', 'remote_agent_id', 'remote_task_id', 'priority',
    'context_json', 'is_writer', 'phase', 'result_summary', 'error', 'created_at',
    'updated_at', 'started_at', 'finished_at',
  ], label);
  if (!ROLES.has(text(row.role, `${label} role`))) throw new Error(`${label} role is invalid`);
  if (row.executor_kind !== 'local' && row.executor_kind !== 'remote_mesh') {
    throw new Error(`${label} executor_kind is invalid`);
  }
  const dependencies = json(row.depends_on, `${label} depends_on`);
  if (!Array.isArray(dependencies) || dependencies.some(item => typeof item !== 'string')) {
    throw new Error(`${label} depends_on is invalid`);
  }
  jsonObject(row.context_json, `${label} context_json`, true);
  string(row.description, `${label} description`);
  string(row.assigned_to, `${label} assigned_to`);
  string(row.remote_agent_id, `${label} remote_agent_id`);
  string(row.remote_task_id, `${label} remote_task_id`);
  if (!['low', 'medium', 'high', 'critical'].includes(string(row.priority, `${label} priority`))) {
    throw new Error(`${label} priority is invalid`);
  }
  string(row.phase, `${label} phase`);
  if (row.is_writer !== 0 && row.is_writer !== 1) throw new Error(`${label} is_writer is invalid`);
  nullableTime(row.started_at, `${label} started_at`);
  nullableTime(row.finished_at, `${label} finished_at`);
  return deepFreeze({
    id: text(row.id, `${label} id`),
    runId: text(row.run_id, `${label} run_id`),
    name: text(row.name, `${label} name`),
    goal: string(row.goal, `${label} goal`),
    status: taskStatus(row.status),
    dependsOn: Object.freeze([...dependencies]),
    ...(string(row.result_summary, `${label} result_summary`)
      ? { resultSummary: row.result_summary as string }
      : {}),
    ...(string(row.error, `${label} error`) ? { error: row.error as string } : {}),
    createdAt: nonNegativeInteger(row.created_at, `${label} created_at`),
    updatedAt: nonNegativeInteger(row.updated_at, `${label} updated_at`),
  });
}

function repositoryEvent(value: unknown, index: number): LegacyEventRecord {
  const label = `legacy orchestration_events[${index}]`;
  const row = exactRecord(value, [
    'id', 'run_id', 'task_id', 'type', 'seq', 'payload_json', 'created_at',
  ], label);
  jsonObject(row.payload_json, `${label} payload_json`, false);
  const taskId = string(row.task_id, `${label} task_id`);
  return deepFreeze({
    id: text(row.id, `${label} id`),
    runId: text(row.run_id, `${label} run_id`),
    ...(taskId ? { taskId } : {}),
    type: eventType(row.type),
    seq: nonNegativeInteger(row.seq, `${label} seq`),
    createdAt: nonNegativeInteger(row.created_at, `${label} created_at`),
  });
}

function snapshotRun(value: unknown): LegacyRunRecord {
  const row = allowedRecord(value, [
    'id', 'sessionKey', 'status', 'title', 'source', 'createdAt', 'updatedAt',
  ], ['id', 'sessionKey', 'status', 'title', 'createdAt', 'updatedAt'], 'legacy snapshot Run');
  if (row.source !== undefined) legacySource(record(row.source, 'legacy snapshot Run source'), 'legacy snapshot Run source');
  return deepFreeze({
    id: text(row.id, 'legacy snapshot Run id'),
    sessionKey: text(row.sessionKey, 'legacy snapshot Run sessionKey'),
    status: runStatus(row.status),
    title: string(row.title, 'legacy snapshot Run title'),
    createdAt: nonNegativeInteger(row.createdAt, 'legacy snapshot Run createdAt'),
    updatedAt: nonNegativeInteger(row.updatedAt, 'legacy snapshot Run updatedAt'),
  });
}

function snapshotTask(value: unknown, index: number): LegacyTaskRecord {
  const label = `legacy snapshot tasks[${index}]`;
  const row = allowedRecord(value, [
    'id', 'runId', 'name', 'description', 'role', 'goal', 'status', 'dependsOn',
    'executorKind', 'assignedTo', 'remoteAgentId', 'resultSummary', 'error', 'context',
    'createdAt', 'updatedAt',
  ], [
    'id', 'runId', 'name', 'description', 'role', 'goal', 'status', 'dependsOn',
    'executorKind', 'createdAt', 'updatedAt',
  ], label);
  if (!ROLES.has(text(row.role, `${label} role`))) throw new Error(`${label} role is invalid`);
  if (row.executorKind !== 'local' && row.executorKind !== 'remote_mesh') {
    throw new Error(`${label} executorKind is invalid`);
  }
  if (!Array.isArray(row.dependsOn) || row.dependsOn.some(item => typeof item !== 'string')) {
    throw new Error(`${label} dependsOn is invalid`);
  }
  if (row.context !== undefined) record(row.context, `${label} context`);
  string(row.description, `${label} description`);
  optionalString(row.assignedTo, `${label} assignedTo`);
  optionalString(row.remoteAgentId, `${label} remoteAgentId`);
  return deepFreeze({
    id: text(row.id, `${label} id`),
    runId: text(row.runId, `${label} runId`),
    name: text(row.name, `${label} name`),
    goal: string(row.goal, `${label} goal`),
    status: taskStatus(row.status),
    dependsOn: Object.freeze([...(row.dependsOn as string[])]),
    ...(optionalString(row.resultSummary, `${label} resultSummary`) === undefined
      ? {}
      : { resultSummary: row.resultSummary as string }),
    ...(optionalString(row.error, `${label} error`) === undefined
      ? {}
      : { error: row.error as string }),
    createdAt: nonNegativeInteger(row.createdAt, `${label} createdAt`),
    updatedAt: nonNegativeInteger(row.updatedAt, `${label} updatedAt`),
  });
}

function snapshotEvent(value: unknown, index: number): LegacyEventRecord {
  const label = `legacy snapshot events[${index}]`;
  const row = allowedRecord(value, [
    'id', 'runId', 'taskId', 'type', 'seq', 'payload', 'createdAt',
  ], ['id', 'runId', 'type', 'seq', 'payload', 'createdAt'], label);
  record(row.payload, `${label} payload`);
  const taskId = optionalString(row.taskId, `${label} taskId`);
  return deepFreeze({
    id: text(row.id, `${label} id`),
    runId: text(row.runId, `${label} runId`),
    ...(taskId ? { taskId } : {}),
    type: eventType(row.type),
    seq: nonNegativeInteger(row.seq, `${label} seq`),
    createdAt: nonNegativeInteger(row.createdAt, `${label} createdAt`),
  });
}

function assertReferences(input: NormalizedLegacyExport): void {
  const runIds = new Set<string>();
  for (const run of input.runs) {
    if (runIds.has(run.id)) throw new Error(`Duplicate legacy Run ${run.id}`);
    runIds.add(run.id);
  }
  const taskIds = new Set<string>();
  const taskRuns = new Map<string, string>();
  for (const task of input.tasks) {
    if (!runIds.has(task.runId)) throw new Error(`Orphan legacy Task ${task.id}`);
    if (taskIds.has(task.id)) throw new Error(`Duplicate legacy Task ${task.id}`);
    taskIds.add(task.id);
    taskRuns.set(task.id, task.runId);
  }
  for (const task of input.tasks) {
    for (const dependency of task.dependsOn) {
      if (taskRuns.get(dependency) !== task.runId) {
        throw new Error(`Legacy Task ${task.id} dependency ${dependency} is orphaned or cross-Run`);
      }
    }
  }
  const eventIds = new Set<string>();
  for (const event of input.events) {
    if (!runIds.has(event.runId)) throw new Error(`Orphan legacy Event ${event.id}`);
    if (event.taskId && !taskIds.has(event.taskId)) throw new Error(`Orphan legacy Event Task ${event.taskId}`);
    if (event.taskId && taskRuns.get(event.taskId) !== event.runId) {
      throw new Error(`Legacy Event ${event.id} crosses Run scope`);
    }
    if (eventIds.has(event.id)) throw new Error(`Duplicate legacy Event ${event.id}`);
    eventIds.add(event.id);
  }
  for (const run of input.runs) {
    const events = input.events.filter(event => event.runId === run.id)
      .sort((left, right) => left.seq - right.seq);
    events.forEach((event, index) => {
      if (event.seq !== index) throw new Error(`Legacy Run ${run.id} event sequence is invalid`);
    });
  }
}

function legacySource(value: Record<string, unknown>, label: string): void {
  if (value.kind === 'manual') {
    allowedRecord(value, ['kind', 'label'], ['kind'], label);
    optionalString(value.label, `${label} label`);
    return;
  }
  if (value.kind === 'im_scene') {
    allowedRecord(value, ['kind', 'scene'], ['kind', 'scene'], label);
    const scene = allowedRecord(
      value.scene,
      ['platform', 'endpointKey', 'sceneId', 'kind', 'senderId', 'parent'],
      ['platform', 'endpointKey', 'sceneId', 'kind'],
      `${label} scene`,
    );
    text(scene.platform, `${label} scene platform`);
    text(scene.endpointKey, `${label} scene endpointKey`);
    text(scene.sceneId, `${label} scene sceneId`);
    if (!['private', 'group', 'channel'].includes(String(scene.kind))) {
      throw new Error(`${label} scene kind is invalid`);
    }
    optionalString(scene.senderId, `${label} scene senderId`);
    if (scene.parent !== undefined) {
      const parent = exactRecord(scene.parent, ['kind', 'sceneId'], `${label} scene parent`);
      if (parent.kind !== 'group' && parent.kind !== 'channel') {
        throw new Error(`${label} scene parent kind is invalid`);
      }
      text(parent.sceneId, `${label} scene parent sceneId`);
    }
    return;
  }
  throw new Error(`${label} kind is unknown`);
}

function assertReport(report: LegacyRunOfflineReport): void {
  const { digest: supplied, ...body } = report;
  if (report.version !== 1
    || report.kind !== 'legacy_run_offline_audit'
    || report.readOnly !== true
    || report.startsAgent !== false
    || report.writesNewJournal !== false
    || supplied !== digest(body)) {
    throw new Error('Legacy Run offline report is invalid or corrupt');
  }
}

function runStatus(value: unknown): LegacyRunStatus {
  if (!RUN_STATUSES.has(value as LegacyRunStatus)) throw new Error('Legacy Run status is invalid');
  return value as LegacyRunStatus;
}

function taskStatus(value: unknown): LegacyTaskStatus {
  if (!TASK_STATUSES.has(value as LegacyTaskStatus)) throw new Error('Legacy Task status is invalid');
  return value as LegacyTaskStatus;
}

function eventType(value: unknown): LegacyEventType {
  if (!EVENT_TYPES.has(value as LegacyEventType)) throw new Error('Legacy Event type is invalid');
  return value as LegacyEventType;
}

function jsonObject(value: unknown, label: string, emptyAllowed: boolean): Record<string, unknown> | undefined {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  if (!value.trim() && emptyAllowed) return undefined;
  const parsed = json(value, label);
  return record(parsed, label);
}

function json(value: unknown, label: string): unknown {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error });
  }
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  return allowedRecord(value, keys, keys, label);
}

function allowedRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): Record<string, unknown> {
  const result = record(value, label);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(result).find(key => !allowedSet.has(key));
  if (unexpected) throw new Error(`${label} contains unknown field ${unexpected}`);
  const missing = required.find(key => !Object.hasOwn(result, key));
  if (missing) throw new Error(`${label} is missing field ${missing}`);
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nullableTime(value: unknown, label: string): number | null {
  return value === null ? null : nonNegativeInteger(value, label);
}

function sameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
