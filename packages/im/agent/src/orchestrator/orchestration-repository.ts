/**
 * OrchestrationRepository — persistent run/task store (Agent Mesh v1).
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@zhin.js/logger';
import { type CreateOrchestrationEventInput, type CreateOrchestrationRunInput, type CreateOrchestrationTaskInput, type OrchestrationEventRecord, type OrchestrationRunRecord, type OrchestrationRunStatus, type OrchestrationTaskRecord, type OrchestrationTaskStatus, parseDependsOn, serializeDependsOn } from '@zhin.js/ai';
const logger = new Logger(null, 'OrchestrationRepository');

type DbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
};

export interface OrchestrationRunWithTasks {
  run: OrchestrationRunRecord;
  tasks: OrchestrationTaskRecord[];
  events?: OrchestrationEventRecord[];
}

export interface OrchestrationRepository {
  createRun(input: CreateOrchestrationRunInput): Promise<OrchestrationRunRecord>;
  getRun(runId: string): Promise<OrchestrationRunRecord | null>;
  listRunsBySessionKey(sessionKey: string): Promise<OrchestrationRunRecord[]>;
  listRunsBySessionKeyPrefix(prefix: string): Promise<OrchestrationRunRecord[]>;
  updateRunStatus(runId: string, status: OrchestrationRunStatus): Promise<boolean>;
  createTask(input: CreateOrchestrationTaskInput): Promise<OrchestrationTaskRecord>;
  getTask(taskId: string): Promise<OrchestrationTaskRecord | null>;
  listTasksByRun(runId: string): Promise<OrchestrationTaskRecord[]>;
  updateTaskStatus(
    taskId: string,
    status: OrchestrationTaskStatus,
    patch?: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'assigned_to' | 'started_at' | 'finished_at'>>,
  ): Promise<boolean>;
  appendEvent(input: CreateOrchestrationEventInput): Promise<OrchestrationEventRecord>;
  listEventsByRun(runId: string): Promise<OrchestrationEventRecord[]>;
  getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null>;
  listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]>;
}

function rowToRun(row: Record<string, unknown>): OrchestrationRunRecord {
  return {
    id: String(row.id ?? ''),
    session_key: String(row.session_key ?? ''),
    status: (row.status as OrchestrationRunRecord['status']) ?? 'open',
    title: String(row.title ?? ''),
    template: String(row.template ?? ''),
    source_json: String(row.source_json ?? ''),
    state_json: String(row.state_json ?? row.mission_state_json ?? ''),
    state_version: Number(row.state_version ?? 0),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  };
}

function rowToTask(row: Record<string, unknown>): OrchestrationTaskRecord {
  return {
    id: String(row.id ?? ''),
    run_id: String(row.run_id ?? ''),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    role: (row.role as OrchestrationTaskRecord['role']) ?? 'subtask',
    goal: String(row.goal ?? ''),
    status: (row.status as OrchestrationTaskStatus) ?? 'pending',
    depends_on: String(row.depends_on ?? '[]'),
    executor_kind: (row.executor_kind as OrchestrationTaskRecord['executor_kind']) ?? 'local',
    assigned_to: String(row.assigned_to ?? ''),
    remote_agent_id: String(row.remote_agent_id ?? ''),
    remote_task_id: String(row.remote_task_id ?? ''),
    priority: String(row.priority ?? 'medium'),
    context_json: String(row.context_json ?? ''),
    is_writer: Number(row.is_writer ?? 0),
    phase: (row.phase as OrchestrationTaskRecord['phase']) ?? '',
    result_summary: String(row.result_summary ?? ''),
    error: String(row.error ?? ''),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
    started_at: row.started_at != null ? Number(row.started_at) : null,
    finished_at: row.finished_at != null ? Number(row.finished_at) : null,
  };
}

function rowToEvent(row: Record<string, unknown>): OrchestrationEventRecord {
  return {
    id: String(row.id ?? ''),
    run_id: String(row.run_id ?? ''),
    task_id: String(row.task_id ?? ''),
    type: row.type as OrchestrationEventRecord['type'],
    seq: Number(row.seq ?? 0),
    payload_json: String(row.payload_json ?? '{}'),
    created_at: Number(row.created_at ?? 0),
  };
}

export class DatabaseOrchestrationRepository implements OrchestrationRepository {
  constructor(
    private readonly runModel: DbModel,
    private readonly taskModel: DbModel,
    private readonly eventModel?: DbModel,
  ) {}

  async createRun(input: CreateOrchestrationRunInput): Promise<OrchestrationRunRecord> {
    const now = Date.now();
    const record: OrchestrationRunRecord = {
      id: randomUUID().slice(0, 8),
      session_key: input.session_key,
      status: 'open',
      title: input.title ?? '',
      template: input.template ?? '',
      source_json: input.source ? JSON.stringify(input.source) : '',
      state_json: input.state ? JSON.stringify(input.state) : '',
      state_version: 0,
      created_at: now,
      updated_at: now,
    };
    await this.runModel.create(record as unknown as Record<string, unknown>);
    return record;
  }

  async getRun(runId: string): Promise<OrchestrationRunRecord | null> {
    const rows = await this.runModel.select().where({ id: runId });
    return rows?.[0] ? rowToRun(rows[0]) : null;
  }

  async listRunsBySessionKey(sessionKey: string): Promise<OrchestrationRunRecord[]> {
    const rows = await this.runModel.select().where({ session_key: sessionKey });
    return (rows ?? []).map(rowToRun).sort((a, b) => b.updated_at - a.updated_at);
  }

  async listRunsBySessionKeyPrefix(prefix: string): Promise<OrchestrationRunRecord[]> {
    const rows = await this.runModel.select().where({});
    return (rows ?? [])
      .map(rowToRun)
      .filter((r) => r.session_key.startsWith(prefix))
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  async updateRunStatus(runId: string, status: OrchestrationRunStatus): Promise<boolean> {
    await this.runModel.update({ status, updated_at: Date.now() }).where({ id: runId });
    return true;
  }

  async createTask(input: CreateOrchestrationTaskInput): Promise<OrchestrationTaskRecord> {
    const now = Date.now();
    const record: OrchestrationTaskRecord = {
      id: randomUUID().slice(0, 8),
      run_id: input.run_id,
      name: input.name,
      description: input.description ?? '',
      role: input.role ?? 'subtask',
      goal: input.goal ?? input.description ?? input.name,
      status: 'pending',
      depends_on: serializeDependsOn(input.depends_on ?? []),
      executor_kind: input.executor_kind ?? 'local',
      assigned_to: input.assigned_to ?? '',
      remote_agent_id: input.remote_agent_id ?? '',
      remote_task_id: '',
      priority: input.priority ?? 'medium',
      context_json: input.context ? JSON.stringify(input.context) : '',
      is_writer: input.is_writer ? 1 : 0,
      phase: input.phase ?? '',
      result_summary: '',
      error: '',
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    };
    await this.taskModel.create(record as unknown as Record<string, unknown>);
    await this.runModel.update({ updated_at: now }).where({ id: input.run_id });
    return record;
  }

  async getTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    const rows = await this.taskModel.select().where({ id: taskId });
    return rows?.[0] ? rowToTask(rows[0]) : null;
  }

  async listTasksByRun(runId: string): Promise<OrchestrationTaskRecord[]> {
    const rows = await this.taskModel.select().where({ run_id: runId });
    return (rows ?? []).map(rowToTask).sort((a, b) => a.created_at - b.created_at);
  }

  async updateTaskStatus(
    taskId: string,
    status: OrchestrationTaskStatus,
    patch: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'assigned_to' | 'started_at' | 'finished_at'>> = {},
  ): Promise<boolean> {
    const data: Record<string, unknown> = { status, updated_at: Date.now(), ...patch };
    await this.taskModel.update(data).where({ id: taskId });
    const task = await this.getTask(taskId);
    if (task) {
      await this.runModel.update({ updated_at: Date.now() }).where({ id: task.run_id });
    }
    return true;
  }

  async appendEvent(input: CreateOrchestrationEventInput): Promise<OrchestrationEventRecord> {
    const now = Date.now();
    const events = await this.listEventsByRun(input.run_id);
    const record: OrchestrationEventRecord = {
      id: randomUUID().slice(0, 8),
      run_id: input.run_id,
      task_id: input.task_id ?? '',
      type: input.type,
      seq: events.length > 0 ? Math.max(...events.map(e => e.seq)) + 1 : 0,
      payload_json: JSON.stringify(input.payload ?? {}),
      created_at: now,
    };
    if (this.eventModel) {
      await this.eventModel.create(record as unknown as Record<string, unknown>);
    }
    await this.runModel.update({ updated_at: now }).where({ id: input.run_id });
    return record;
  }

  async listEventsByRun(runId: string): Promise<OrchestrationEventRecord[]> {
    if (!this.eventModel) return [];
    const rows = await this.eventModel.select().where({ run_id: runId });
    return (rows ?? []).map(rowToEvent).sort((a, b) => a.seq - b.seq);
  }

  async getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    const tasks = await this.listTasksByRun(runId);
    const events = await this.listEventsByRun(runId);
    return { run, tasks, events };
  }

  async listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]> {
    const rows = await this.taskModel.select().where({ executor_kind: 'remote_mesh' });
    return (rows ?? [])
      .map(rowToTask)
      .filter((t) => t.status === 'pending' || t.status === 'assigned' || t.status === 'running' || t.status === 'waiting_result');
  }

}

/** In-memory fallback when DB models are unavailable. */
export class MemoryOrchestrationRepository implements OrchestrationRepository {
  private runs = new Map<string, OrchestrationRunRecord>();
  private tasks = new Map<string, OrchestrationTaskRecord>();
  private events = new Map<string, OrchestrationEventRecord[]>();
  private static readonly MAX_RUNS = 1000;
  private static readonly MAX_TASKS = 5000;

  async createRun(input: CreateOrchestrationRunInput): Promise<OrchestrationRunRecord> {
    const now = Date.now();
    const record: OrchestrationRunRecord = {
      id: randomUUID().slice(0, 8),
      session_key: input.session_key,
      status: 'open',
      title: input.title ?? '',
      template: input.template ?? '',
      source_json: input.source ? JSON.stringify(input.source) : '',
      state_json: input.state ? JSON.stringify(input.state) : '',
      state_version: 0,
      created_at: now,
      updated_at: now,
    };
    this.runs.set(record.id, record);
    this.evictIfNeeded();
    return record;
  }

  async getRun(runId: string): Promise<OrchestrationRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async listRunsBySessionKey(sessionKey: string): Promise<OrchestrationRunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.session_key === sessionKey)
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  async listRunsBySessionKeyPrefix(prefix: string): Promise<OrchestrationRunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.session_key.startsWith(prefix))
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  async updateRunStatus(runId: string, status: OrchestrationRunStatus): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run) return false;
    run.status = status;
    run.updated_at = Date.now();
    return true;
  }

  async createTask(input: CreateOrchestrationTaskInput): Promise<OrchestrationTaskRecord> {
    const now = Date.now();
    const record: OrchestrationTaskRecord = {
      id: randomUUID().slice(0, 8),
      run_id: input.run_id,
      name: input.name,
      description: input.description ?? '',
      role: input.role ?? 'subtask',
      goal: input.goal ?? input.description ?? input.name,
      status: 'pending',
      depends_on: serializeDependsOn(input.depends_on ?? []),
      executor_kind: input.executor_kind ?? 'local',
      assigned_to: input.assigned_to ?? '',
      remote_agent_id: input.remote_agent_id ?? '',
      remote_task_id: '',
      priority: input.priority ?? 'medium',
      context_json: input.context ? JSON.stringify(input.context) : '',
      is_writer: input.is_writer ? 1 : 0,
      phase: input.phase ?? '',
      result_summary: '',
      error: '',
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    };
    this.tasks.set(record.id, record);
    this.evictIfNeeded();
    const run = this.runs.get(input.run_id);
    if (run) run.updated_at = now;
    return record;
  }

  async getTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async listTasksByRun(runId: string): Promise<OrchestrationTaskRecord[]> {
    return [...this.tasks.values()]
      .filter((t) => t.run_id === runId)
      .sort((a, b) => a.created_at - b.created_at);
  }

  async updateTaskStatus(
    taskId: string,
    status: OrchestrationTaskStatus,
    patch: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'assigned_to' | 'started_at' | 'finished_at'>> = {},
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = status;
    task.updated_at = Date.now();
    if (patch.result_summary !== undefined) task.result_summary = patch.result_summary;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.remote_task_id !== undefined) task.remote_task_id = patch.remote_task_id;
    if (patch.assigned_to !== undefined) task.assigned_to = patch.assigned_to;
    if (patch.started_at !== undefined) task.started_at = patch.started_at;
    if (patch.finished_at !== undefined) task.finished_at = patch.finished_at;
    const run = this.runs.get(task.run_id);
    if (run) run.updated_at = Date.now();
    return true;
  }

  async appendEvent(input: CreateOrchestrationEventInput): Promise<OrchestrationEventRecord> {
    const now = Date.now();
    const events = this.events.get(input.run_id) ?? [];
    const record: OrchestrationEventRecord = {
      id: randomUUID().slice(0, 8),
      run_id: input.run_id,
      task_id: input.task_id ?? '',
      type: input.type,
      seq: events.length > 0 ? Math.max(...events.map(e => e.seq)) + 1 : 0,
      payload_json: JSON.stringify(input.payload ?? {}),
      created_at: now,
    };
    this.events.set(input.run_id, [...events, record]);
    const run = this.runs.get(input.run_id);
    if (run) run.updated_at = now;
    return record;
  }

  async listEventsByRun(runId: string): Promise<OrchestrationEventRecord[]> {
    return [...(this.events.get(runId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    return {
      run,
      tasks: await this.listTasksByRun(runId),
      events: await this.listEventsByRun(runId),
    };
  }

  async listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]> {
    return [...this.tasks.values()].filter(
      (t) => t.executor_kind === 'remote_mesh'
        && (t.status === 'pending' || t.status === 'assigned' || t.status === 'running' || t.status === 'waiting_result'),
    );
  }

  private evictIfNeeded(): void {
    if (this.runs.size > MemoryOrchestrationRepository.MAX_RUNS) {
      const sorted = [...this.runs.entries()].sort((a, b) => a[1].updated_at - b[1].updated_at);
      const excess = this.runs.size - Math.floor(MemoryOrchestrationRepository.MAX_RUNS * 0.8);
      for (let i = 0; i < excess && i < sorted.length; i++) {
        this.runs.delete(sorted[i][0]);
      }
    }
    if (this.tasks.size > MemoryOrchestrationRepository.MAX_TASKS) {
      const sorted = [...this.tasks.entries()].sort((a, b) => a[1].updated_at - b[1].updated_at);
      const excess = this.tasks.size - Math.floor(MemoryOrchestrationRepository.MAX_TASKS * 0.8);
      for (let i = 0; i < excess && i < sorted.length; i++) {
        this.tasks.delete(sorted[i][0]);
      }
    }
  }

  dispose(): void {
    this.runs.clear();
    this.tasks.clear();
    this.events.clear();
  }

  runCount(): number {
    return this.runs.size;
  }

  taskCount(): number {
    return this.tasks.size;
  }
}

export function taskRecordToAgentTaskShape(task: OrchestrationTaskRecord): {
  id: string;
  runId: string;
  name: string;
  description: string;
  role: OrchestrationTaskRecord['role'];
  goal: string;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  status: OrchestrationTaskStatus;
  executorKind: OrchestrationTaskRecord['executor_kind'];
  remoteAgentId: string;
  remoteTaskId: string;
} {
  let context: Record<string, unknown> | undefined;
  if (task.context_json?.trim()) {
    try {
      context = JSON.parse(task.context_json) as Record<string, unknown>;
    } catch (err) {
      logger.debug('taskRecordToAgentTaskShape: invalid context_json', err);
    }
  }
  return {
    id: task.id,
    runId: task.run_id,
    name: task.name,
    description: task.description,
    role: task.role,
    goal: task.goal,
    dependencies: parseDependsOn(task.depends_on),
    priority: (task.priority as 'low' | 'medium' | 'high' | 'critical') || 'medium',
    context,
    status: task.status,
    executorKind: task.executor_kind,
    remoteAgentId: task.remote_agent_id,
    remoteTaskId: task.remote_task_id,
  };
}
