/**
 * Project director orchestration tools — Agent Mesh hard orchestration v1.
 */
import type { AgentTool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import type { AgentRole } from '../orchestrator/agent-dispatcher.js';
import {
  getOrchestrationService,
  type OrchestrationAddTaskInput,
} from '../orchestrator/orchestration-service.js';
import { writeOrchestrationRunSummaryToMemory } from '../orchestration-memory-hook.js';
import type { MissionState } from '../orchestrator/mission-state.js';

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
  if (snapshot.run.mission_state_json?.trim()) {
    try {
      const ms = JSON.parse(snapshot.run.mission_state_json) as MissionState;
      lines.push('', '## Mission State');
      lines.push(`phase: ${ms.phase}`);
      if (ms.validation_spec_paths?.length) {
        lines.push(`spec_paths: ${ms.validation_spec_paths.join(', ')}`);
      }
      if (ms.last_validation) {
        lines.push(`last_validation: passed=${ms.last_validation.passed} failed=${ms.last_validation.failed}`);
      }
    } catch {
      // ignore invalid mission state
    }
  }
  return lines.join('\n');
}

const START_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Run 标题' },
    remote_validator: {
      type: 'string',
      description: '可选：Validate 跑在 remote:<agentId>',
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
      enum: ['planner', 'subtask', 'reviewer', 'researcher', 'executor', 'worker', 'validator'],
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

const PATCH_STATE_PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', description: '编排 run ID' },
    patch: { type: 'object', description: 'Mission State 部分更新（JSON）' },
  },
  required: ['run_id', 'patch'],
};

class OrchestrationPatchStateTool extends BuiltinBaseTool {
  readonly name = 'orchestration_patch_state';
  readonly description = '更新 Mission State（missions Broadcast 共享状态；按 phase ACL 校验）。';
  readonly parameters = PATCH_STATE_PARAMS;

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const runId = String(args.run_id ?? '');
    if (!runId) return '请提供 run_id';
    const patch = args.patch;
    if (!patch || typeof patch !== 'object') return '请提供 patch 对象';
    try {
      const next = await svc.patchMissionState(runId, patch as Partial<MissionState>);
      if (!next) return `Run ${runId} 不存在`;
      return `Mission State 已更新：phase=${next.phase} spec_paths=${next.validation_spec_paths.length}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}

class OrchestrationStartTool extends BuiltinBaseTool {
  readonly name = 'orchestration_start';
  readonly description = '创建 Mission 编排 run（missions 五阶段 DAG）；MissionRunner 自动推进。';
  readonly parameters = START_PARAMS;

  constructor(private readonly sessionContext: ToolContext) {
    super();
    this.tags.push('orchestration', 'director');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const svc = requireService();
    const sessionKey = sessionKeyFromContext(this.sessionContext);
    const title = typeof args.title === 'string' ? args.title : undefined;
    const remoteValidator = typeof args.remote_validator === 'string'
      ? args.remote_validator.replace(/^remote:/, '')
      : undefined;
    const snapshot = await svc.startRun({ sessionKey, title, remoteValidator });
    const { isMissionsTemplate } = await import('../orchestrator/mission-state.js');
    if (isMissionsTemplate({ template: snapshot.run.template })) {
      const { getMissionRunner } = await import('../orchestrator/mission-runner.js');
      const runner = getMissionRunner();
      if (runner) {
        void runner.notifyRunStarted(snapshot.run.id, sessionKey);
        void runner.advanceRun(snapshot.run.id);
      }
    }
    const tpl = snapshot.run.template || '(custom)';
    return (
      `编排 run 已创建：${snapshot.run.id}\n`
      + `template: ${tpl}\n`
      + `session: ${sessionKey}\n`
      + `tasks: ${snapshot.tasks.map((t) => `${t.id}(${t.role})`).join(', ') || '(empty)'}\n`
      + (snapshot.tasks.length
        ? 'MissionRunner 将自动推进；无需手动 spawn_task。'
        : '使用 orchestration_add_task 添加节点。')
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
    new OrchestrationPatchStateTool().toTool(),
  ] as AgentTool[];
}

export const ORCHESTRATION_TOOL_NAMES = [
  'orchestration_start',
  'orchestration_add_task',
  'orchestration_status',
  'orchestration_complete',
  'orchestration_retry_task',
  'orchestration_skip_task',
  'orchestration_patch_state',
] as const;
