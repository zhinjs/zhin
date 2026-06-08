/**
 * OrchestrationService — project director run/task lifecycle (Agent Mesh v1).
 */
import type { OrchestrationTaskRecord } from '@zhin.js/ai';
import type { AgentRole, AgentTask } from './agent-dispatcher.js';
import { getAgentDispatcher } from './agent-dispatcher.js';
import {
  type OrchestrationRepository,
  type OrchestrationRunWithTasks,
  taskRecordToAgentTaskShape,
} from './orchestration-repository.js';

export const PLAN_DEV_REVIEW_TEMPLATE = 'plan-dev-review';

export interface OrchestrationStartInput {
  sessionKey: string;
  title?: string;
  template?: string;
}

export interface OrchestrationAddTaskInput {
  runId: string;
  name: string;
  description?: string;
  role?: AgentRole;
  goal?: string;
  dependsOn?: string[];
  executor?: 'local' | `remote:${string}`;
  context?: Record<string, unknown>;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export class OrchestrationService {
  constructor(private readonly repository: OrchestrationRepository) {}

  get repositoryHandle(): OrchestrationRepository {
    return this.repository;
  }

  async startRun(input: OrchestrationStartInput): Promise<OrchestrationRunWithTasks> {
    const run = await this.repository.createRun({
      session_key: input.sessionKey,
      title: input.title ?? 'Orchestration run',
      template: input.template ?? '',
    });

    if (input.template === PLAN_DEV_REVIEW_TEMPLATE) {
      const planner = await this.addTask({
        runId: run.id,
        name: 'Plan',
        role: 'planner',
        goal: 'Produce implementation plan and task breakdown',
        description: 'Planning phase',
      });
      const dev = await this.addTask({
        runId: run.id,
        name: 'Develop',
        role: 'subtask',
        goal: 'Implement according to the plan',
        description: 'Development phase',
        dependsOn: [planner.id],
      });
      await this.addTask({
        runId: run.id,
        name: 'Review',
        role: 'reviewer',
        goal: 'Review and validate deliverables',
        description: 'Review phase',
        dependsOn: [dev.id],
      });
      return { run, tasks: await this.repository.listTasksByRun(run.id) };
    }

    return { run, tasks: [] };
  }

  async addTask(input: OrchestrationAddTaskInput): Promise<OrchestrationTaskRecord> {
    let executor_kind: 'local' | 'remote' = 'local';
    let remote_agent_id = '';
    if (input.executor?.startsWith('remote:')) {
      executor_kind = 'remote';
      remote_agent_id = input.executor.slice('remote:'.length);
    }

    const task = await this.repository.createTask({
      run_id: input.runId,
      name: input.name,
      description: input.description,
      role: input.role,
      goal: input.goal,
      depends_on: input.dependsOn,
      executor_kind,
      remote_agent_id,
      priority: input.priority,
      context: input.context,
    });

    const dispatcher = getAgentDispatcher();
    dispatcher.syncTaskFromRecord(task);
    return task;
  }

  async getStatus(runId: string): Promise<OrchestrationRunWithTasks | null> {
    const snapshot = await this.repository.getRunWithTasks(runId);
    if (!snapshot) return null;
    const dispatcher = getAgentDispatcher();
    for (const task of snapshot.tasks) {
      dispatcher.syncTaskFromRecord(task);
    }
    return snapshot;
  }

  async completeRun(runId: string, force = false): Promise<{ ok: boolean; message: string }> {
    const snapshot = await this.getStatus(runId);
    if (!snapshot) return { ok: false, message: `Run ${runId} not found` };

    const blocking = snapshot.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'running',
    );
    if (blocking.length > 0 && !force) {
      return {
        ok: false,
        message: `Run has ${blocking.length} incomplete task(s). Use force=true to close anyway.`,
      };
    }

    const hasFailed = snapshot.tasks.some((t) => t.status === 'failed');
    await this.repository.updateRunStatus(runId, hasFailed && !force ? 'failed' : 'completed');
    return { ok: true, message: `Run ${runId} marked ${hasFailed && !force ? 'failed' : 'completed'}` };
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
    return { ok: true, message: `Task ${taskId} reset to pending` };
  }

  async skipTask(taskId: string, reason: string): Promise<{ ok: boolean; message: string }> {
    const task = await this.repository.getTask(taskId);
    if (!task) return { ok: false, message: `Task ${taskId} not found` };
    if (task.status !== 'failed' && task.status !== 'pending') {
      return { ok: false, message: `Task ${taskId} is ${task.status}, cannot skip` };
    }
    await this.repository.updateTaskStatus(taskId, 'skipped', {
      error: reason || 'skipped by director',
      finished_at: Date.now(),
    });
    const updated = await this.repository.getTask(taskId);
    if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
    return { ok: true, message: `Task ${taskId} skipped` };
  }

  async listRuns(sessionKey?: string): Promise<OrchestrationRunWithTasks[]> {
    if (!sessionKey) {
      return [];
    }
    const runs = await this.repository.listRunsBySessionKey(sessionKey);
    const out: OrchestrationRunWithTasks[] = [];
    for (const run of runs) {
      const tasks = await this.repository.listTasksByRun(run.id);
      out.push({ run, tasks });
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
}

let globalService: OrchestrationService | null = null;

export function initOrchestrationService(repository: OrchestrationRepository): OrchestrationService {
  globalService = new OrchestrationService(repository);
  getAgentDispatcher().setRepository(repository);
  return globalService;
}

export function getOrchestrationService(): OrchestrationService | null {
  return globalService;
}
