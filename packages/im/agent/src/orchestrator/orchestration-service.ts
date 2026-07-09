/**
 * OrchestrationKernel — Agent Run lifecycle, task state machine, event log.
 */
import type {
  CreateOrchestrationTaskInput,
  OrchestrationEventRecord,
  OrchestrationRunRecord,
  OrchestrationRunSource,
  OrchestrationRunStatus,
  OrchestrationTaskRecord,
  OrchestrationTaskStatus,
} from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { type AgentRole, type AgentTask, getAgentDispatcher } from './agent-dispatcher.js';
import {
  type OrchestrationRepository,
  type OrchestrationRunWithTasks,
  taskRecordToAgentTaskShape,
} from './orchestration-repository.js';
import { mapEventRecord, mapRunRecord, mapTaskRecord, normalizeExecutorKind } from './orchestration-mappers.js';
import type {
  AgentExecutionEvent,
  AgentExecutor,
  ExecutorKind,
  OrchestrationRun,
  OrchestrationTask,
  RunEvent,
  RunSnapshot,
  WorkflowStrategy,
  WorkflowTaskSpec,
} from './orchestration-types.js';
export interface OrchestrationStartInput {
  sessionKey: string;
  title?: string;
  source?: OrchestrationRunSource;
  state?: Record<string, unknown>;
}

export interface OrchestrationAddTaskInput {
  runId: string;
  name: string;
  description?: string;
  role?: AgentRole;
  goal?: string;
  dependsOn?: string[];
  executor?: 'local' | 'remote' | ExecutorKind | `remote:${string}`;
  assignedTo?: string;
  context?: Record<string, unknown>;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DispatchTaskInput extends Omit<OrchestrationAddTaskInput, 'executor'> {
  executorKind?: ExecutorKind;
  remoteAgentId?: string;
  message?: Message;
  autoStart?: boolean;
}

export interface HandleUserMessageInput {
  sessionKey: string;
  content: string;
  title?: string;
  source?: OrchestrationRunSource;
  message?: Message;
  task?: Partial<DispatchTaskInput>;
  autoStart?: boolean;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationRunStatus> = new Set(['open', 'running', 'waiting']);
const ACTIVE_TASK_STATUSES: ReadonlySet<OrchestrationTaskStatus> = new Set([
  'pending',
  'assigned',
  'running',
  'waiting_result',
]);
const TERMINAL_TASK_STATUSES: ReadonlySet<OrchestrationTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

function normalizeExecutor(input?: OrchestrationAddTaskInput['executor']): {
  executorKind: ExecutorKind;
  remoteAgentId?: string;
} {
  const value = String(input ?? 'local');
  if (value === 'local') return { executorKind: 'local' };
  if (value === 'remote') return { executorKind: 'remote_mesh' };
  if (value.startsWith('remote:')) {
    return { executorKind: 'remote_mesh', remoteAgentId: value.slice('remote:'.length) };
  }
  if (value === 'group_mention' || value === 'scene_mention') return { executorKind: 'im_projection' };
  if (value === 'internal_room' || value === 'im_projection' || value === 'remote_mesh') {
    return { executorKind: value };
  }
  return { executorKind: 'local' };
}

async function* resultIterable(result: Promise<string> | string): AsyncIterable<AgentExecutionEvent> {
  const value = await result;
  yield { type: 'result', result: value };
}

export class OrchestrationKernel {
  private executors = new Map<ExecutorKind, AgentExecutor>();
  private strategies = new Map<string, WorkflowStrategy>();
  private waiters = new Map<string, Array<(task: OrchestrationTask) => void>>();

  constructor(private repository: OrchestrationRepository) {}

  get repositoryHandle(): OrchestrationRepository {
    return this.repository;
  }

  /**
   * Swap the backing repository in-place (preserves registered executors/strategies).
   * Used by the DB activation path to upgrade from the Memory placeholder without
   * discarding executor/strategy registrations made during bootstrap.
   */
  replaceRepository(repository: OrchestrationRepository): void {
    this.repository = repository;
  }

  registerExecutor(executor: AgentExecutor): () => void {
    this.executors.set(executor.kind, executor);
    return () => {
      if (this.executors.get(executor.kind) === executor) this.executors.delete(executor.kind);
    };
  }

  registerWorkflowStrategy(strategy: WorkflowStrategy): () => void {
    this.strategies.set(strategy.name, strategy);
    return () => {
      if (this.strategies.get(strategy.name) === strategy) this.strategies.delete(strategy.name);
    };
  }

  async startRun(input: OrchestrationStartInput): Promise<OrchestrationRunWithTasks> {
    const run = await this.repository.createRun({
      session_key: input.sessionKey,
      title: input.title ?? 'Agent run',
      source: input.source,
      state: input.state,
    });
    await this.appendEvent(run.id, 'run.started', undefined, {
      title: run.title,
      source: input.source ?? null,
    });
    return { run, tasks: [], events: await this.repository.listEventsByRun(run.id) };
  }

  async findOrCreateRun(input: OrchestrationStartInput): Promise<OrchestrationRunRecord> {
    const existing = (await this.repository.listRunsBySessionKey(input.sessionKey))
      .find((run) => ACTIVE_RUN_STATUSES.has(run.status));
    if (existing) return existing;
    return (await this.startRun(input)).run;
  }

  async addTask(input: OrchestrationAddTaskInput): Promise<OrchestrationTaskRecord> {
    const executor = normalizeExecutor(input.executor);
    return this.createTaskRecord({
      run_id: input.runId,
      name: input.name,
      description: input.description,
      role: input.role,
      goal: input.goal,
      depends_on: input.dependsOn,
      executor_kind: executor.executorKind,
      assigned_to: input.assignedTo,
      remote_agent_id: executor.remoteAgentId,
      priority: input.priority,
      context: input.context,
    });
  }

  async dispatchTask(input: DispatchTaskInput): Promise<{ run: OrchestrationRun; task: OrchestrationTask }> {
    const record = await this.createTaskRecord({
      run_id: input.runId,
      name: input.name,
      description: input.description,
      role: input.role,
      goal: input.goal,
      depends_on: input.dependsOn,
      executor_kind: input.executorKind ?? 'local',
      assigned_to: input.assignedTo,
      remote_agent_id: input.remoteAgentId,
      priority: input.priority,
      context: input.context,
    });
    const snapshot = await this.getSnapshot(input.runId);
    const task = mapTaskRecord(record);
    if (input.autoStart !== false) {
      void this.runTask(record.id, input.message).catch((err) => {
        void this.safeFailTask(record.id, err instanceof Error ? err.message : String(err));
      });
    }
    return { run: snapshot.run, task };
  }

  async handleUserMessage(input: HandleUserMessageInput): Promise<{ run: OrchestrationRun; task: OrchestrationTask }> {
    const run = await this.findOrCreateRun({
      sessionKey: input.sessionKey,
      title: input.title ?? (input.content.slice(0, 80) || 'IM agent run'),
      source: input.source,
    });
    return this.dispatchTask({
      runId: run.id,
      name: input.task?.name ?? 'Handle user message',
      description: input.task?.description ?? input.content,
      role: input.task?.role ?? 'planner',
      goal: input.task?.goal ?? input.content,
      executorKind: input.task?.executorKind ?? 'local',
      assignedTo: input.task?.assignedTo,
      context: input.task?.context,
      message: input.message,
      autoStart: input.autoStart,
    });
  }

  async runWorkflowStrategy(name: string, input: HandleUserMessageInput): Promise<RunSnapshot> {
    const strategy = this.strategies.get(name);
    if (!strategy) throw new Error(`Workflow strategy ${name} is not registered`);
    const runRecord = await this.findOrCreateRun({
      sessionKey: input.sessionKey,
      title: input.title ?? (input.content.slice(0, 80) || `${name} run`),
      source: input.source,
    });
    const run = mapRunRecord(runRecord);
    const specs = await strategy.plan({ run, goal: input.content, message: input.message });
    const taskIdsByKey = new Map<string, string>();
    for (const spec of specs) {
      const task = await this.dispatchWorkflowTask(run.id, spec, input.message, taskIdsByKey);
      if (spec.key) taskIdsByKey.set(spec.key, task.id);
    }
    return this.getSnapshot(run.id);
  }

  async runTaskWithResult(taskId: string, result: Promise<string> | string): Promise<OrchestrationTask> {
    return this.runTask(taskId, undefined, {
      kind: 'local',
      execute: () => resultIterable(result),
    });
  }

  async runTask(taskId: string, message?: Message, overrideExecutor?: AgentExecutor): Promise<OrchestrationTask> {
    const taskRecord = await this.repository.getTask(taskId);
    if (!taskRecord) throw new Error(`task ${taskId} not found`);
    const runRecord = await this.repository.getRun(taskRecord.run_id);
    if (!runRecord) throw new Error(`run ${taskRecord.run_id} not found`);
    if (!ACTIVE_TASK_STATUSES.has(taskRecord.status)) return mapTaskRecord(taskRecord);

    const executorKind = normalizeExecutorKind(taskRecord.executor_kind);
    const executor = overrideExecutor ?? this.executors.get(executorKind);
    if (!executor) {
      await this.repository.updateTaskStatus(taskId, 'waiting_result');
      await this.appendEvent(taskRecord.run_id, 'task.progress', taskId, {
        status: 'waiting_result',
        reason: `executor ${executorKind} not registered`,
      });
      return mapTaskRecord((await this.repository.getTask(taskId))!);
    }

    await this.repository.updateRunStatus(taskRecord.run_id, 'running');
    await this.repository.updateTaskStatus(taskId, 'running', { started_at: Date.now() });
    await this.appendEvent(taskRecord.run_id, 'run.status_changed', undefined, { status: 'running' });
    await this.appendEvent(taskRecord.run_id, 'task.started', taskId, { executorKind: taskRecord.executor_kind });

    let completed = false;
    try {
      const run = mapRunRecord(runRecord);
      const task = mapTaskRecord((await this.repository.getTask(taskId))!);
      for await (const event of executor.execute({ run, task, message })) {
        await this.consumeExecutionEvent(taskId, event);
        if (event.type === 'result') completed = true;
      }
      if (!completed) {
        const afterLoop = await this.repository.getTask(taskId);
        if (afterLoop && !TERMINAL_TASK_STATUSES.has(afterLoop.status)) {
          await this.repository.updateTaskStatus(taskId, 'waiting_result');
          await this.appendEvent(taskRecord.run_id, 'task.progress', taskId, { status: 'waiting_result' });
        }
      }
    } catch (err) {
      return this.safeFailTask(taskId, err instanceof Error ? err.message : String(err));
    }

    return mapTaskRecord((await this.repository.getTask(taskId))!);
  }

  async completeTask(taskId: string, result: string): Promise<OrchestrationTask> {
    const task = await this.requireTask(taskId);
    if (task.status === 'completed') {
      return mapTaskRecord(task);
    }
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      throw new Error(`task ${taskId} is ${task.status}, cannot complete`);
    }
    await this.repository.updateTaskStatus(taskId, 'completed', {
      result_summary: result,
      error: '',
      finished_at: Date.now(),
    });
    const completedRecord = await this.repository.getTask(taskId);
    if (completedRecord) getAgentDispatcher().syncTaskFromRecord(completedRecord);
    await this.appendEvent(task.run_id, 'task.completed', taskId, { result });
    await this.appendEvent(task.run_id, 'result.returned', taskId, { result });
    await this.recomputeRunStatus(task.run_id);
    const updated = mapTaskRecord((await this.repository.getTask(taskId))!);
    this.notifyWaiters(updated);
    return updated;
  }

  async failTask(taskId: string, error: string): Promise<OrchestrationTask> {
    const task = await this.requireTask(taskId);
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      return mapTaskRecord(task);
    }
    await this.repository.updateTaskStatus(taskId, 'failed', {
      error,
      result_summary: '',
      finished_at: Date.now(),
    });
    const failedRecord = await this.repository.getTask(taskId);
    if (failedRecord) getAgentDispatcher().syncTaskFromRecord(failedRecord);
    await this.appendEvent(task.run_id, 'task.failed', taskId, { error });
    await this.recomputeRunStatus(task.run_id);
    const updated = mapTaskRecord((await this.repository.getTask(taskId))!);
    this.notifyWaiters(updated);
    return updated;
  }

  async taskThinking(taskId: string, text: string): Promise<void> {
    const task = await this.requireTask(taskId);
    await this.appendEvent(task.run_id, 'task.thinking', taskId, { text });
  }

  async taskProgress(taskId: string, text: string): Promise<void> {
    const task = await this.requireTask(taskId);
    await this.appendEvent(task.run_id, 'task.progress', taskId, { text });
  }

  /** Mark task waiting on external handback (e.g. remote mesh); kernel-owned status transition. */
  async markTaskWaitingResult(
    taskId: string,
    patch: { remoteTaskId?: string; progress?: string } = {},
  ): Promise<OrchestrationTask> {
    const task = await this.requireTask(taskId);
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      return mapTaskRecord(task);
    }
    await this.repository.updateTaskStatus(taskId, 'waiting_result', {
      remote_task_id: patch.remoteTaskId,
      started_at: task.started_at ?? Date.now(),
    });
    if (patch.progress) {
      await this.appendEvent(task.run_id, 'task.progress', taskId, { text: patch.progress });
    }
    const updated = await this.repository.getTask(taskId);
    if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
    await this.recomputeRunStatus(task.run_id);
    return mapTaskRecord((await this.repository.getTask(taskId))!);
  }

  /** Cancel an active task (mesh / director); idempotent when already cancelled. */
  async cancelTask(taskId: string, reason: string): Promise<OrchestrationTask> {
    const task = await this.requireTask(taskId);
    if (task.status === 'cancelled') {
      return mapTaskRecord(task);
    }
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      throw new Error(`task ${taskId} is ${task.status}, cannot cancel`);
    }
    await this.repository.updateTaskStatus(taskId, 'cancelled', {
      error: reason,
      result_summary: '',
      finished_at: Date.now(),
    });
    const updated = await this.repository.getTask(taskId);
    if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
    await this.appendEvent(task.run_id, 'task.failed', taskId, { cancelled: true, reason });
    await this.recomputeRunStatus(task.run_id);
    const mapped = mapTaskRecord((await this.repository.getTask(taskId))!);
    this.notifyWaiters(mapped);
    return mapped;
  }

  /** failTask wrapper that never throws on terminal races (executor catch paths). */
  async safeFailTask(taskId: string, error: string): Promise<OrchestrationTask> {
    try {
      return await this.failTask(taskId, error);
    } catch (err) {
      const task = await this.repository.getTask(taskId);
      if (task && TERMINAL_TASK_STATUSES.has(task.status)) {
        return mapTaskRecord(task);
      }
      throw err;
    }
  }

  async waitForTask(taskId: string, timeoutMs = 120_000): Promise<OrchestrationTask> {
    const current = await this.repository.getTask(taskId);
    if (!current) throw new Error(`task ${taskId} not found`);
    if (!ACTIVE_TASK_STATUSES.has(current.status)) return mapTaskRecord(current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(taskId) ?? [];
        this.waiters.set(taskId, list.filter(fn => fn !== done));
        reject(new Error(`task ${taskId} timed out`));
      }, timeoutMs);
      const done = (task: OrchestrationTask) => {
        clearTimeout(timer);
        resolve(task);
      };
      this.waiters.set(taskId, [...(this.waiters.get(taskId) ?? []), done]);
    });
  }

  async getStatus(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const snapshot = await this.repository.getRunWithTasks(runId);
    if (!snapshot) return null;
    const dispatcher = getAgentDispatcher();
    for (const task of snapshot.tasks) dispatcher.syncTaskFromRecord(task);
    return snapshot;
  }

  async getSnapshot(runId: string): Promise<RunSnapshot> {
    const snapshot = await this.repository.getRunWithTasks(runId);
    if (!snapshot) throw new Error(`run ${runId} not found`);
    return {
      run: mapRunRecord(snapshot.run),
      tasks: snapshot.tasks.map(mapTaskRecord),
      events: (snapshot.events ?? []).map(mapEventRecord),
    };
  }

  async completeRun(runId: string, force = false): Promise<{ ok: boolean; message: string }> {
    const snapshot = await this.getStatus(runId);
    if (!snapshot) return { ok: false, message: `Run ${runId} not found` };
    const blocking = snapshot.tasks.filter(t => ACTIVE_TASK_STATUSES.has(t.status));
    if (blocking.length > 0 && !force) {
      return {
        ok: false,
        message: `Run has ${blocking.length} incomplete task(s). Use force=true to close anyway.`,
      };
    }
    const hasFailed = snapshot.tasks.some((t) => t.status === 'failed');
    const status: OrchestrationRunStatus = hasFailed && !force ? 'failed' : 'completed';
    await this.repository.updateRunStatus(runId, status);
    await this.appendEvent(runId, 'run.status_changed', undefined, { status });
    return { ok: true, message: `Run ${runId} marked ${status}` };
  }

  async retryTask(taskId: string): Promise<{ ok: boolean; message: string }> {
    const task = await this.repository.getTask(taskId);
    if (!task) return { ok: false, message: `Task ${taskId} not found` };
    if (task.status !== 'failed') {
      return { ok: false, message: `Task ${taskId} is ${task.status}, only failed tasks can be retried` };
    }
    await this.repository.updateTaskStatus(taskId, 'pending', {
      error: '',
      result_summary: '',
      started_at: null,
      finished_at: null,
    });
    const updated = await this.repository.getTask(taskId);
    if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
    await this.appendEvent(task.run_id, 'task.progress', taskId, { status: 'pending', action: 'retry' });
    return { ok: true, message: `Task ${taskId} reset to pending` };
  }

  async skipTask(taskId: string, reason: string): Promise<{ ok: boolean; message: string }> {
    const task = await this.repository.getTask(taskId);
    if (!task) return { ok: false, message: `Task ${taskId} not found` };
    if (task.status !== 'failed' && task.status !== 'pending') {
      return { ok: false, message: `Task ${taskId} is ${task.status}, cannot cancel` };
    }
    await this.repository.updateTaskStatus(taskId, 'cancelled', {
      error: reason || 'cancelled by director',
      finished_at: Date.now(),
    });
    const updated = await this.repository.getTask(taskId);
    if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
    await this.appendEvent(task.run_id, 'task.failed', taskId, { cancelled: true, reason });
    await this.recomputeRunStatus(task.run_id);
    return { ok: true, message: `Task ${taskId} cancelled` };
  }

  async listRuns(sessionKey?: string): Promise<OrchestrationRunWithTasks[]> {
    if (!sessionKey) return [];
    const runs = await this.repository.listRunsBySessionKey(sessionKey);
    const out: OrchestrationRunWithTasks[] = [];
    for (const run of runs) {
      const tasks = await this.repository.listTasksByRun(run.id);
      const events = await this.repository.listEventsByRun(run.id);
      out.push({ run, tasks, events });
    }
    return out;
  }

  taskToAgentTask(task: OrchestrationTaskRecord): AgentTask {
    const shape = taskRecordToAgentTaskShape(task);
    return {
      id: shape.id,
      runId: shape.runId,
      name: shape.name,
      description: shape.description,
      role: shape.role as AgentRole,
      goal: shape.goal,
      dependencies: shape.dependencies,
      priority: shape.priority,
      context: shape.context,
      status: shape.status,
      executorKind: shape.executorKind,
      remoteAgentId: shape.remoteAgentId,
      remoteTaskId: shape.remoteTaskId,
    };
  }

  private async createTaskRecord(input: CreateOrchestrationTaskInput): Promise<OrchestrationTaskRecord> {
    const record = await this.repository.createTask(input);
    getAgentDispatcher().syncTaskFromRecord(record);
    await this.appendEvent(record.run_id, 'task.created', record.id, {
      name: record.name,
      role: record.role,
      executorKind: record.executor_kind,
    });
    await this.repository.updateTaskStatus(record.id, 'assigned', {
      assigned_to: record.assigned_to,
    });
    const assigned = (await this.repository.getTask(record.id)) ?? record;
    getAgentDispatcher().syncTaskFromRecord(assigned);
    await this.appendEvent(record.run_id, 'task.assigned', record.id, {
      executorKind: record.executor_kind,
      assignedTo: record.assigned_to || null,
    });
    await this.recomputeRunStatus(record.run_id);
    return assigned;
  }

  private async dispatchWorkflowTask(
    runId: string,
    spec: WorkflowTaskSpec,
    message: Message | undefined,
    taskIdsByKey: ReadonlyMap<string, string>,
  ): Promise<OrchestrationTask> {
    const dependsOn = spec.dependsOn?.map((dep) => taskIdsByKey.get(dep) ?? dep);
    const dispatched = await this.dispatchTask({
      runId,
      name: spec.name,
      description: spec.description,
      role: spec.role,
      goal: spec.goal,
      dependsOn,
      executorKind: spec.executorKind ?? 'local',
      assignedTo: spec.assignedTo,
      context: spec.context,
      message,
      autoStart: false,
    });
    return dispatched.task;
  }

  private async consumeExecutionEvent(taskId: string, event: AgentExecutionEvent): Promise<void> {
    if (event.type === 'thinking') {
      await this.taskThinking(taskId, event.text ?? '');
      return;
    }
    if (event.type === 'progress') {
      await this.taskProgress(taskId, event.text ?? '');
      return;
    }
    if (event.type === 'result') {
      await this.completeTask(taskId, event.result ?? event.text ?? '');
      return;
    }
    if (event.type === 'error') {
      await this.failTask(taskId, event.error ?? event.text ?? 'task failed');
    }
  }

  private async recomputeRunStatus(runId: string): Promise<void> {
    const snapshot = await this.repository.getRunWithTasks(runId);
    if (!snapshot) return;
    let status: OrchestrationRunStatus = 'completed';
    if (snapshot.tasks.some(t => t.status === 'failed')) status = 'failed';
    else if (snapshot.tasks.some(t => t.status === 'running')) status = 'running';
    else if (snapshot.tasks.some(t => t.status === 'waiting_result' || t.status === 'assigned' || t.status === 'pending')) status = 'waiting';
    await this.repository.updateRunStatus(runId, status);
    await this.appendEvent(runId, 'run.status_changed', undefined, { status });
  }

  private async requireTask(taskId: string): Promise<OrchestrationTaskRecord> {
    const task = await this.repository.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    return task;
  }

  private async appendEvent(
    runId: string,
    type: OrchestrationEventRecord['type'],
    taskId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<RunEvent> {
    return mapEventRecord(await this.repository.appendEvent({
      run_id: runId,
      task_id: taskId,
      type,
      payload,
    }));
  }

  private notifyWaiters(task: OrchestrationTask): void {
    const waiters = this.waiters.get(task.id) ?? [];
    this.waiters.delete(task.id);
    for (const waiter of waiters) waiter(task);
  }
}

export class OrchestrationService extends OrchestrationKernel {}

let globalService: OrchestrationService | null = null;

export function initOrchestrationService(repository: OrchestrationRepository): OrchestrationService {
  globalService = new OrchestrationService(repository);
  getAgentDispatcher().setRepository(repository);
  return globalService;
}

/**
 * Upgrade the global kernel's repository in-place. If no kernel exists yet, this
 * is equivalent to {@link initOrchestrationService}. Otherwise it swaps the
 * repository while preserving registered executors and workflow strategies —
 * used by the DB activation path to move from the Memory placeholder to a
 * Database repository without losing bootstrap-time registrations.
 */
export function upgradeOrchestrationRepository(repository: OrchestrationRepository): OrchestrationService {
  const existing = globalService;
  if (existing) {
    existing.replaceRepository(repository);
    getAgentDispatcher().setRepository(repository);
    return existing;
  }
  return initOrchestrationService(repository);
}

export function getOrchestrationService(): OrchestrationService | null {
  return globalService;
}

export function getOrchestrationKernel(): OrchestrationKernel | null {
  return globalService;
}
