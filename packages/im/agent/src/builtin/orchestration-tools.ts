/**
 * Project director orchestration tools — Agent Mesh hard orchestration v1.
 */
import type { AgentTool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import type { AgentRole } from '../orchestrator/agent-dispatcher.js';
import {
  getOrchestrationService,
  PLAN_DEV_REVIEW_TEMPLATE,
  type OrchestrationAddTaskInput,
} from '../orchestrator/orchestration-service.js';
import { writeOrchestrationRunSummaryToMemory } from '../orchestration-memory-hook.js';

function sessionKeyFromContext(ctx: ToolContext): string {
  return resolveIMSessionIdFromToolContext({
    platform: ctx.platform || '',
    botId: ctx.botId || '',
    scope: ctx.scope,
    sceneId: ctx.sceneId || '',
    senderId: ctx.senderId || '',
  });
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
        + (t.executor_kind === 'remote' ? ` remote:${t.remote_agent_id}` : '')
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
    title: { type: 'string', description: 'Run 标题' },
    template: {
      type: 'string',
      enum: [PLAN_DEV_REVIEW_TEMPLATE],
      description: '可选模板：plan-dev-review 预置 planner→dev→review 三节点',
    },
  },
};

const ADD_TASK_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: '编排 run ID' },
    name: { type: 'string', description: '任务名称' },
    description: { type: 'string', description: '任务描述' },
    role: {
      type: 'string',
      enum: ['planner', 'subtask', 'reviewer', 'researcher', 'executor', 'worker'],
      description: 'Agent 角色',
    },
    goal: { type: 'string', description: '任务目标' },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      description: '依赖任务 ID 列表',
    },
    executor: {
      type: 'string',
      description: 'local 或 remote:<agentId>',
    },
    context: { type: 'object', description: '结构化上下文（JSON）' },
  },
  required: ['run_id', 'name'],
};

const RUN_ID_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: '编排 run ID' },
    force: { type: 'boolean', description: '强制关闭（忽略未完成节点）' },
  },
  required: ['run_id'],
};

const TASK_ID_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: '任务 ID' },
    reason: { type: 'string', description: 'skip 原因' },
  },
  required: ['task_id'],
};

class OrchestrationStartTool extends BuiltinBaseTool {
  readonly name = 'orchestration_start';
  readonly description = '创建编排 run（项目总监接手一次工程）。可选 template=plan-dev-review 预置三阶段 DAG。';
  readonly parameters = START_PARAMS;

  constructor(private readonly sessionContext: ToolContext) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const sessionKey = sessionKeyFromContext(this.sessionContext);
    const title = typeof args.title === 'string' ? args.title : undefined;
    const template = typeof args.template === 'string' ? args.template : undefined;
    const snapshot = await svc.startRun({ sessionKey, title, template });
    return (
      `编排 run 已创建：${snapshot.run.id}\n`
      + `session: ${sessionKey}\n`
      + `tasks: ${snapshot.tasks.map((t) => `${t.id}(${t.role})`).join(', ') || '(empty)'}\n`
      + '使用 orchestration_add_task 添加节点，spawn_task 时传 run_id + task_id 执行。'
    );
  }
}

class OrchestrationAddTaskTool extends BuiltinBaseTool {
  readonly name = 'orchestration_add_task';
  readonly description = '向 run 添加 DAG 节点（role、depends_on、executor）。';
  readonly parameters = ADD_TASK_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';

    const input: OrchestrationAddTaskInput = {
      runId,
      name: String(args.name ?? 'task'),
      description: typeof args.description === 'string' ? args.description : undefined,
      role: typeof args.role === 'string' ? (args.role as AgentRole) : undefined,
      goal: typeof args.goal === 'string' ? args.goal : undefined,
      dependsOn: Array.isArray(args.depends_on) ? args.depends_on.map(String) : undefined,
      executor: typeof args.executor === 'string'
        ? (args.executor as OrchestrationAddTaskInput['executor'])
        : undefined,
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
  readonly description = '查询 run 及 DAG 任务状态。';
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
  readonly description = '关闭编排 run（默认要求无 pending/running 节点）。';
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
  readonly description = '将 failed 任务重置为 pending，解锁下游。';
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
  readonly description = '跳过 failed/pending 任务（记录 reason），解锁下游。';
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

export function createOrchestrationTools(context: ToolContext): AgentTool[] {
  return [
    new OrchestrationStartTool(context).toTool(),
    new OrchestrationAddTaskTool().toTool(),
    new OrchestrationStatusTool().toTool(),
    new OrchestrationCompleteTool().toTool(),
    new OrchestrationRetryTaskTool().toTool(),
    new OrchestrationSkipTaskTool().toTool(),
  ] as AgentTool[];
}

export const ORCHESTRATION_TOOL_NAMES = [
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
] as const;
