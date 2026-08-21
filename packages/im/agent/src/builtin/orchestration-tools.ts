/**
 * Project director orchestration tools — Agent Mesh hard orchestration v1.
 */
import { type Message, type Tool, type ToolParametersSchema, type ToolResult, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import type { AgentRole } from '../orchestrator/agent-dispatcher.js';
import {
  type OrchestrationService,
  type OrchestrationAddTaskInput,
} from '../orchestrator/orchestration-service.js';
import { orchestrationSourceFromMessage } from '../orchestrator/orchestration-source.js';
function sessionKeyFromContext(commMessage: Message<any>): string {
  return resolveIMSessionIdFromMessage(commMessage);
}

function formatRunStatus(runId: string, snapshot: Awaited<ReturnType<OrchestrationService['getStatus']>>): string {
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
      enum: ['local', 'remote_mesh'],
      description: 'Executor: local (configured Agent binding) or remote_mesh (A2A remote)',
    },
    assigned_to: {
      type: 'string',
      description: 'Configured Agent binding for local, or remote Agent ID for remote_mesh',
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

  constructor(
    private readonly sessionContext: Message<any>,
    private readonly service: OrchestrationService,
  ) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
    const sessionKey = sessionKeyFromContext(this.sessionContext);
    const title = typeof args.title === 'string' ? args.title : undefined;
    const snapshot = await svc.startRun({
      sessionKey,
      title,
      source: orchestrationSourceFromMessage(this.sessionContext),
    });
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
  readonly description = 'Add a DAG node to a run and optionally execute it with a configured local Agent or remote A2A Agent.';
  readonly parameters = ADD_TASK_PARAMS;

  constructor(
    private readonly sessionContext: Message<any>,
    private readonly service: OrchestrationService,
  ) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';

    const autoStart = args.auto_start !== false;
    const executorKind = typeof args.executor === 'string' ? args.executor : undefined;
    const assignedTo = typeof args.assigned_to === 'string' ? args.assigned_to : undefined;
    if (executorKind && executorKind !== 'local' && executorKind !== 'remote_mesh') {
      return `不支持的 executor: ${executorKind}`;
    }

    if (autoStart) {
      const { run, task } = await svc.dispatchTask({
        runId,
        name: String(args.name ?? 'task'),
        description: typeof args.description === 'string' ? args.description : undefined,
        role: typeof args.role === 'string' ? (args.role as AgentRole) : undefined,
        goal: typeof args.goal === 'string' ? args.goal : undefined,
        dependsOn: Array.isArray(args.depends_on) ? args.depends_on.map(String) : undefined,
        executorKind: executorKind as 'local' | 'remote_mesh' | undefined,
        assignedTo,
        context: args.context && typeof args.context === 'object'
          ? (args.context as Record<string, unknown>)
          : undefined,
        message: this.sessionContext,
        autoStart: true,
      });
      const status = task.status;
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

  constructor(private readonly service: OrchestrationService) { super(); }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
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

  constructor(private readonly service: OrchestrationService) { super(); }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';
    const result = await svc.completeRun(runId, args.force === true);
    return result.message;
  }
}

class OrchestrationRetryTaskTool extends BuiltinBaseTool {
  readonly name = 'orchestration_retry_task';
  readonly description = 'Reset a failed task to pending and unblock downstream nodes.';
  readonly parameters = TASK_ID_PARAMS;

  constructor(private readonly service: OrchestrationService) { super(); }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
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

  constructor(private readonly service: OrchestrationService) { super(); }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = this.service;
    const taskId = String(args.task_id ?? '');
    if (!taskId) return '请提供 task_id';
    const reason = typeof args.reason === 'string' ? args.reason : 'skipped by director';
    const result = await svc.skipTask(taskId, reason);
    return result.message;
  }
}

export function createOrchestrationTools(
  commMessage: Message,
  service: OrchestrationService,
): Tool[] {
  return [
    new OrchestrationStartTool(commMessage, service).toTool(),
    new OrchestrationAddTaskTool(commMessage, service).toTool(),
    new OrchestrationStatusTool(service).toTool(),
    new OrchestrationCompleteTool(service).toTool(),
    new OrchestrationRetryTaskTool(service).toTool(),
    new OrchestrationSkipTaskTool(service).toTool(),
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
