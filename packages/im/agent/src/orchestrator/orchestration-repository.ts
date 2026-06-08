/**
 * OrchestrationRepository — persistent run/task store (Agent Mesh v1).
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@zhin.js/logger';
import type {
  CreateOrchestrationRunInput,
  CreateOrchestrationTaskInput,
  OrchestrationRunRecord,
  OrchestrationRunStatus,
  OrchestrationTaskRecord,
  OrchestrationTaskStatus,
} from '@zhin.js/ai';
import {
  parseDependsOn,
  serializeDependsOn,
} from '@zhin.js/ai';

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
    patch?: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'started_at' | 'finished_at'>>,
  ): Promise<boolean>;
  getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null>;
  listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]>;
}

function rowToRun(row: Record<string, unknown>): OrchestrationRunRecord {
  return {
    id: String(row.id ?? ''),
    session_key: String(row.session_key ?? ''),
    status: (row.status as OrchestrationRunStatus) ?? 'active',
    title: String(row.title ?? ''),
    template: String(row.template ?? ''),
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
    remote_agent_id: String(row.remote_agent_id ?? ''),
    remote_task_id: String(row.remote_task_id ?? ''),
    priority: String(row.priority ?? 'medium'),
    context_json: String(row.context_json ?? ''),
    result_summary: String(row.result_summary ?? ''),
    error: String(row.error ?? ''),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
    started_at: row.started_at != null ? Number(row.started_at) : null,
    finished_at: row.finished_at != null ? Number(row.finished_at) : null,
  };
}

export class DatabaseOrchestrationRepository implements OrchestrationRepository {
  constructor(
    private readonly runModel: DbModel,
    private readonly taskModel: DbModel,
  ) {}

  async createRun(input: CreateOrchestrationRunInput): Promise<OrchestrationRunRecord> {
    const now = Date.now();
    const record: OrchestrationRunRecord = {
      id: randomUUID().slice(0, 8),
      session_key: input.session_key,
      status: 'active',
      title: input.title ?? '',
      template: input.template ?? '',
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
      remote_agent_id: input.remote_agent_id ?? '',
      remote_task_id: '',
      priority: input.priority ?? 'medium',
      context_json: input.context ? JSON.stringify(input.context) : '',
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
    patch: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'started_at' | 'finished_at'>> = {},
  ): Promise<boolean> {
    const data: Record<string, unknown> = { status, updated_at: Date.now(), ...patch };
    await this.taskModel.update(data).where({ id: taskId });
    const task = await this.getTask(taskId);
    if (task) {
      await this.runModel.update({ updated_at: Date.now() }).where({ id: task.run_id });
    }
    return true;
  }

  async getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    const tasks = await this.listTasksByRun(runId);
    return { run, tasks };
  }

  async listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]> {
    const rows = await this.taskModel.select().where({ executor_kind: 'remote' });
    return (rows ?? [])
      .map(rowToTask)
      .filter((t) => t.status === 'pending' || t.status === 'running');
  }
}

/** In-memory fallback when DB models are unavailable. */
export class MemoryOrchestrationRepository implements OrchestrationRepository {
  private runs = new Map<string, OrchestrationRunRecord>();
  private tasks = new Map<string, OrchestrationTaskRecord>();

  async createRun(input: CreateOrchestrationRunInput): Promise<OrchestrationRunRecord> {
    const now = Date.now();
    const record: OrchestrationRunRecord = {
      id: randomUUID().slice(0, 8),
      session_key: input.session_key,
      status: 'active',
      title: input.title ?? '',
      template: input.template ?? '',
      created_at: now,
      updated_at: now,
    };
    this.runs.set(record.id, record);
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
      remote_agent_id: input.remote_agent_id ?? '',
      remote_task_id: '',
      priority: input.priority ?? 'medium',
      context_json: input.context ? JSON.stringify(input.context) : '',
      result_summary: '',
      error: '',
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    };
    this.tasks.set(record.id, record);
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
    patch: Partial<Pick<OrchestrationTaskRecord, 'result_summary' | 'error' | 'remote_task_id' | 'started_at' | 'finished_at'>> = {},
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = status;
    task.updated_at = Date.now();
    if (patch.result_summary !== undefined) task.result_summary = patch.result_summary;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.remote_task_id !== undefined) task.remote_task_id = patch.remote_task_id;
    if (patch.started_at !== undefined) task.started_at = patch.started_at;
    if (patch.finished_at !== undefined) task.finished_at = patch.finished_at;
    const run = this.runs.get(task.run_id);
    if (run) run.updated_at = Date.now();
    return true;
  }

  async getRunWithTasks(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    return { run, tasks: await this.listTasksByRun(runId) };
  }

  async listActiveRemoteTasks(): Promise<OrchestrationTaskRecord[]> {
    return [...this.tasks.values()].filter(
      (t) => t.executor_kind === 'remote' && (t.status === 'pending' || t.status === 'running'),
    );
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
