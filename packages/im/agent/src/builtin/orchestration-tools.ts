/**
 * Project director orchestration tools — Agent Mesh hard orchestration v1.
 */
import { type Message, type Tool, type ToolParametersSchema, type ToolResult, sceneRefFromMessage, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import type { AgentRole } from '../orchestrator/agent-dispatcher.js';
import {
  getOrchestrationService,
  type OrchestrationAddTaskInput,
} from '../orchestrator/orchestration-service.js';
import { orchestrationSourceFromMessage } from '../collaboration/collaboration-kernel-bridge.js';
import { writeOrchestrationRunSummaryToMemory } from '../orchestration-memory-hook.js';
function sessionKeyFromContext(commMessage: Message<any>): string {
  return resolveIMSessionIdFromMessage(commMessage);
}

function requireService(): NonNullable<ReturnType<typeof getOrchestrationService>> {
  const svc = getOrchestrationService();
  if (!svc) throw new Error('OrchestrationService 未初始化');
  return svc;
}

function formatRunStatus(runId: string, snapshot: Awaited<ReturnType<ReturnType<typeof requireService>['getStatus']>>): string {
  if (!snapshot) return `Run ${runId} 不存在`;
  const lines = [
    `# Run ${snapshot.run.id}`,
    `status: ${snapshot.run.status}`,
    `title: ${snapshot.run.title}`,
    `template: ${snapshot.run.template || '(none)'}`,
    `session: ${snapshot.run.session_key}`,
    '',
    '## Tasks',
  ];
  for (const t of snapshot.tasks) {
    lines.push(
      `- [${t.status}] ${t.id} (${t.role}) ${t.name}`
        + (t.executor_kind === 'remote_mesh' ? ` remote:${t.remote_agent_id}` : '')
        + (t.depends_on && t.depends_on !== '[]' ? ` deps:${t.depends_on}` : ''),
    );
    if (t.result_summary) lines.push(`  result: ${t.result_summary.slice(0, 200)}`);
    if (t.error) lines.push(`  error: ${t.error.slice(0, 200)}`);
  }
  return lines.join('\n');
}

const START_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Run title' },
    remote_validator: {
      type: 'string',
      description: 'Optional: run Validate on remote:<agentId>',
    },
    collaboration_scene_id: {
      type: 'string',
      description: 'Optional: collaboration scene ID; binds Mission run to GroupCell (ADR 0023)',
    },
  },
};

const ADD_TASK_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: 'Orchestration run ID' },
    name: { type: 'string', description: 'Task name' },
    description: { type: 'string', description: 'Task description' },
    role: {
      type: 'string',
      enum: ['planner', 'subtask', 'reviewer', 'researcher', 'evaluator', 'executor', 'worker'],
      description: 'Agent role',
    },
    goal: { type: 'string', description: 'Task goal' },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      description: 'Dependent task ID list',
    },
    executor: {
      type: 'string',
      enum: ['local', 'internal_room', 'im_projection', 'remote_mesh', 'scene_mention'],
      description: 'Executor: local (local sub-agent), internal_room (same-instance peer), im_projection (IM group projection only), remote_mesh (A2A remote)',
    },
    assigned_to: {
      type: 'string',
      description: 'Target endpoint ID (required for internal_room / im_projection)',
    },
    project_to_im: {
      type: 'boolean',
      description: 'After internal_room dispatch, project @mention to the group (default false)',
    },
    auto_start: {
      type: 'boolean',
      description: 'Execute immediately (default true; false creates task only)',
    },
    context: { type: 'object', description: 'Structured context (JSON)' },
  },
  required: ['run_id', 'name'],
};

const RUN_ID_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: 'Orchestration run ID' },
    force: { type: 'boolean', description: 'Force close (ignore unfinished nodes)' },
  },
  required: ['run_id'],
};

const TASK_ID_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'Task ID' },
    reason: { type: 'string', description: 'Skip reason' },
  },
  required: ['task_id'],
};

class OrchestrationStartTool extends BuiltinBaseTool {
  readonly name = 'orchestration_start';
  readonly description = 'Create an orchestration run.';
  readonly parameters = START_PARAMS;

  constructor(private readonly sessionContext: Message<any>) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const sessionKey = sessionKeyFromContext(this.sessionContext);
    const title = typeof args.title === 'string' ? args.title : undefined;
    const collaborationSceneId = typeof args.collaboration_scene_id === 'string' ? args.collaboration_scene_id : undefined;
    const snapshot = await svc.startRun({
      sessionKey,
      title,
      source: orchestrationSourceFromMessage(this.sessionContext, collaborationSceneId),
    });
    if (collaborationSceneId) {
      const { getCollaborationSceneService } = await import('../collaboration/scene-service.js');
      await getCollaborationSceneService().setMissionRunId(collaborationSceneId, snapshot.run.id);
    }
    return (
      `编排 run 已创建：${snapshot.run.id}\n`
      + `session: ${sessionKey}\n`
      + `tasks: ${snapshot.tasks.map((t) => `${t.id}(${t.role})`).join(', ') || '(empty)'}\n`
      + '使用 orchestration_add_task 添加节点，或使用 spawn_task 创建并执行 kernel task。'
    );
  }
}

class OrchestrationAddTaskTool extends BuiltinBaseTool {
  readonly name = 'orchestration_add_task';
  readonly description = 'Add a DAG node to a run and optionally execute immediately (supports internal_room / im_projection).';
  readonly parameters = ADD_TASK_PARAMS;

  constructor(private readonly sessionContext: Message<any>) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';

    const autoStart = args.auto_start !== false;
    const executorKind = typeof args.executor === 'string' ? args.executor : undefined;
    const assignedTo = typeof args.assigned_to === 'string' ? args.assigned_to : undefined;
    const projectToIm = args.project_to_im === true;
    const sceneKind = sceneRefFromMessage(this.sessionContext)?.kind;

    if (executorKind === 'internal_room' || executorKind === 'im_projection' || executorKind === 'scene_mention') {
      if (!assignedTo) {
        return 'executor=internal_room 或 im_projection 时必须提供 assigned_to（目标 endpoint ID）';
      }
      if (sceneKind === 'private') {
        return 'internal_room / im_projection 不支持 private 场景，请使用 local 或 spawn_task';
      }
    }

    if (autoStart) {
      const { run, task } = await svc.dispatchTask({
        runId,
        name: String(args.name ?? 'task'),
        description: typeof args.description === 'string' ? args.description : undefined,
        role: typeof args.role === 'string' ? (args.role as AgentRole) : undefined,
        goal: typeof args.goal === 'string' ? args.goal : undefined,
        dependsOn: Array.isArray(args.depends_on) ? args.depends_on.map(String) : undefined,
        executorKind: executorKind as 'local' | 'internal_room' | 'im_projection' | 'remote_mesh' | undefined,
        assignedTo,
        context: {
          ...(args.context && typeof args.context === 'object'
            ? (args.context as Record<string, unknown>)
            : {}),
          ...(projectToIm ? { projectToIm: true } : {}),
        },
        message: this.sessionContext,
        autoStart: true,
      });
      const status = task.status;
      if (status === 'waiting_result') {
        return `任务已派发并 @ 通知 ${assignedTo ?? ''}：${task.id} (${task.role}) status=${status}\n等待对方 handback 后自动完成。`;
      }
      return `任务已派发：${task.id} (${task.role}) status=${status}`;
    }

    const input: OrchestrationAddTaskInput = {
      runId,
      name: String(args.name ?? 'task'),
      description: typeof args.description === 'string' ? args.description : undefined,
      role: typeof args.role === 'string' ? (args.role as AgentRole) : undefined,
      goal: typeof args.goal === 'string' ? args.goal : undefined,
      dependsOn: Array.isArray(args.depends_on) ? args.depends_on.map(String) : undefined,
      executor: executorKind as OrchestrationAddTaskInput['executor'],
      assignedTo,
      context: args.context && typeof args.context === 'object'
        ? (args.context as Record<string, unknown>)
        : undefined,
    };

    const task = await svc.addTask(input);
    return `任务已添加：${task.id} (${task.role}) status=${task.status}`;
  }
}

class OrchestrationStatusTool extends BuiltinBaseTool {
  readonly name = 'orchestration_status';
  readonly description = 'Query run and DAG task status.';
  readonly parameters = RUN_ID_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';
    const snapshot = await svc.getStatus(runId);
    return formatRunStatus(runId, snapshot);
  }
}

class OrchestrationCompleteTool extends BuiltinBaseTool {
  readonly name = 'orchestration_complete';
  readonly description = 'Close an orchestration run (by default requires no pending/running nodes).';
  readonly parameters = RUN_ID_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';
    const result = await svc.completeRun(runId, args.force === true);
    if (result.ok) {
      const snapshot = await svc.getStatus(runId);
      if (snapshot) await writeOrchestrationRunSummaryToMemory(snapshot);
    }
    return result.message;
  }
}

class OrchestrationRetryTaskTool extends BuiltinBaseTool {
  readonly name = 'orchestration_retry_task';
  readonly description = 'Reset a failed task to pending and unblock downstream nodes.';
  readonly parameters = TASK_ID_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const taskId = String(args.task_id ?? '');
    if (!taskId) return '请提供 task_id';
    const result = await svc.retryTask(taskId);
    return result.message;
  }
}

class OrchestrationSkipTaskTool extends BuiltinBaseTool {
  readonly name = 'orchestration_skip_task';
  readonly description = 'Skip a failed/pending task (records reason) and unblock downstream nodes.';
  readonly parameters = TASK_ID_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const taskId = String(args.task_id ?? '');
    if (!taskId) return '请提供 task_id';
    const reason = typeof args.reason === 'string' ? args.reason : 'skipped by director';
    const result = await svc.skipTask(taskId, reason);
    return result.message;
  }
}

export function createOrchestrationTools(commMessage: Message): Tool[] {
  return [
    new OrchestrationStartTool(commMessage).toTool(),
    new OrchestrationAddTaskTool(commMessage).toTool(),
    new OrchestrationStatusTool().toTool(),
    new OrchestrationCompleteTool().toTool(),
    new OrchestrationRetryTaskTool().toTool(),
    new OrchestrationSkipTaskTool().toTool(),
  ];
}

export const ORCHESTRATION_TOOL_NAMES = [
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
] as const;
