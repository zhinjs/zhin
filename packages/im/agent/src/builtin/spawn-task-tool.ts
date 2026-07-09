/**
 * spawn_task — 主会话将耗时任务派给后台子 agent（与 issue #396 对齐）
 */
import type { Message, Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import {
  getLoadedToolNamesFromSnapshot,
  type AgentTool,
  type OrchestrationRunSource,
} from '@zhin.js/ai';
import { orchestrationSourceFromMessage } from '../collaboration/collaboration-kernel-bridge.js';
import type { SubagentSystem, SubagentOrigin } from '../subagent/index.js';
import type { SubagentContextMode } from '../subagent-preset.js';
import { getAgentDispatcher } from '../orchestrator/agent-dispatcher.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { executeRemoteOrchestrationTask } from '../orchestrator/remote-task-executor.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getDeferredToolRuntime } from './deferred-tool-meta.js';
import {
  assertSpawnAgentAllowed,
  type PermissionTaskRules,
} from '../spawn/permission-task.js';

export interface SpawnTaskToolOptions {
  /** 经 permission.task 过滤后可展示的子 agent 名 */
  allowedAgents?: string[];
  permissionTaskRules?: PermissionTaskRules;
}

function buildSpawnTaskDescription(allowedAgents?: string[]): string {
  const lines = [
    'Delegate complex or long-running work to a sub-agent. By default creates a kernel task, runs asynchronously, and returns #taskId; set wait=true to block until completion.',
    'You may issue multiple spawn_task calls in one assistant turn when subtasks are independent (prefer parallel spawn for independent work).',
    'Use draw for text-to-image and vision for image understanding. Image results log preview as {image}; when wait=true, do not tell the user to wait.',
  ];
  if (allowedAgents?.length) {
    lines.push(`Allowed sub-agent types: ${allowedAgents.join(', ')}.`);
  } else {
    lines.push('Allowed sub-agent types are defined in ai.agents and agents/*.agent.md.');
  }
  return lines.join(' ');
}

export const SPAWN_TASK_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description: 'Detailed task description for the sub-agent (goals, scope, expected output).',
    },
    label: {
      type: 'string',
      description: 'Short display label (optional).',
    },
    agent: {
      type: 'string',
      description: 'Sub-agent name (must exist in ai.agents and agents/<name>.agent.md; default subtask toolset).',
    },
    wait: {
      type: 'boolean',
      description: 'If true, wait synchronously for the sub-agent to finish and return its result.',
    },
    context: {
      type: 'string',
      enum: ['fork', 'fresh'],
      description:
        'Context mode: fork injects recent parent session messages; fresh starts empty. Default follows *.agent.md or role.',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tool names the subtask needs (recommended).',
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'Skill names the subtask needs (recommended).',
    },
    run_id: {
      type: 'string',
      description: 'Hard orchestration run ID (use with task_id).',
    },
    task_id: {
      type: 'string',
      description: 'Hard orchestration task ID (must exist via orchestration_add_task or template).',
    },
  },
  required: ['task'],
};

export function originFromMessage(message: Message): SubagentOrigin {
  return { message };
}

function runTitle(label: string | undefined, task: string): string {
  return label ?? (task.slice(0, 80) || 'spawn_task');
}

function sourceFromMessage(message: Message): OrchestrationRunSource {
  return orchestrationSourceFromMessage(message);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
  return items.length > 0 ? items : undefined;
}

export class SpawnTaskBuiltinTool extends BuiltinBaseTool {
  readonly name = 'spawn_task';
  readonly description: string;
  readonly parameters = SPAWN_TASK_PARAMETERS;
  private readonly permissionTaskRules?: PermissionTaskRules;

  constructor(
    private readonly sessionCommMessage: Message,
    private readonly manager: SubagentSystem,
    options?: SpawnTaskToolOptions,
  ) {
    super();
    this.description = buildSpawnTaskDescription(options?.allowedAgents);
    this.permissionTaskRules = options?.permissionTaskRules;
    this.tags.push('agent', 'async', 'task', '后台', '子任务');
    this.keywords.push('后台', '异步', '子任务', 'spawn', 'background', '并行', '独立处理');
  }

  toTool(): Tool {
    const tool = super.toTool();
    tool.source = 'builtin:context';
    return tool;
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    const task = args.task;
    const label = args.label;
    const agentName = args.agent;
    if (typeof task !== 'string' || !task) {
      return '请提供任务描述';
    }

    const runId = typeof args.run_id === 'string' ? args.run_id.trim() : '';
    const orchestrationTaskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';

    if (runId && !orchestrationTaskId) {
      return 'spawn_task 须同时提供 run_id 与 task_id';
    }

    const svc = getOrchestrationService();
    let targetRunId = runId;
    let targetTaskId = orchestrationTaskId;

    if (targetTaskId) {
      const dispatcher = getAgentDispatcher();
      if (runId) {
        await dispatcher.hydrateRun(runId);
      }
      const gate = dispatcher.canExecute(targetTaskId);
      if (!gate.canExecute) {
        return `无法执行 task ${targetTaskId}：${gate.reason ?? '门禁未通过'}`;
      }
      const agentTask = dispatcher.getTask(targetTaskId);
      if (agentTask?.executorKind === 'remote_mesh') {
        const remoteResult = await executeRemoteOrchestrationTask(targetTaskId);
        if (args.wait === true) {
          return remoteResult.message;
        }
        return remoteResult.message;
      }
    }

    const origin = originFromMessage(this.sessionCommMessage);
    const labelStr = typeof label === 'string' ? label : undefined;
    const agentOpt = typeof agentName === 'string' && agentName.trim() ? agentName.trim() : undefined;
    const permissionError = assertSpawnAgentAllowed(agentOpt, this.permissionTaskRules);
    if (permissionError) return permissionError;
    const contextMode: SubagentContextMode | undefined =
      args.context === 'fork' || args.context === 'fresh' ? args.context : undefined;
    const orchestrationRole = targetTaskId
      ? getAgentDispatcher().getTask(targetTaskId)?.role
      : undefined;
    const requestedTools = parseStringArray(args.tools);
    const requestedSkills = parseStringArray(args.skills);
    const deferredRuntime = getDeferredToolRuntime(this.sessionCommMessage);
    const parentSessionLoaded = deferredRuntime
      ? getLoadedToolNamesFromSnapshot(deferredRuntime.snapshot)
      : undefined;
    const parentLoadedSkills = deferredRuntime?.snapshot.loadedSkills;

    if (svc && !targetTaskId) {
      const sessionKey = resolveIMSessionIdFromMessage(this.sessionCommMessage);
      const run = await svc.findOrCreateRun({
        sessionKey,
        title: runTitle(labelStr, task),
        source: sourceFromMessage(this.sessionCommMessage),
      });
      const dispatched = await svc.dispatchTask({
        runId: run.id,
        name: runTitle(labelStr, task),
        description: task,
        role: orchestrationRole ?? 'subtask',
        goal: task,
        executorKind: 'local',
        assignedTo: agentOpt,
        context: {
          tool: 'spawn_task',
          agent: agentOpt ?? null,
          contextMode: contextMode ?? null,
        },
        message: this.sessionCommMessage,
        autoStart: false,
      });
      targetRunId = dispatched.run.id;
      targetTaskId = dispatched.task.id;
    }

    const opts = {
      task,
      label: labelStr,
      origin,
      agent: agentOpt,
      role: orchestrationRole,
      notifyContext: this.sessionCommMessage,
      contextMode,
      orchestrationTaskId: targetTaskId || undefined,
      requestedTools,
      requestedSkills,
      parentSessionLoaded,
      parentLoadedSkills,
    };

    if (args.wait === true) {
      if (typeof this.manager.spawnSync !== 'function') {
        return this.manager.spawn(opts);
      }
      if (!svc || !targetTaskId) {
        const result = await this.manager.spawnSync(opts);
        return (
          `子任务${labelStr ? `「${labelStr}」` : ''}已完成（同步等待）。\n\n${result}\n\n`
          + '请根据以上结果继续后续步骤。'
        );
      }
      const resultTask = await svc.runTaskWithResult(targetTaskId, this.manager.spawnSync(opts));
      if (resultTask.status === 'failed') {
        return `子任务 #${targetTaskId} 执行失败：${resultTask.error ?? 'unknown error'}`;
      }
      return (
        `子任务 #${targetTaskId}${labelStr ? `「${labelStr}」` : ''}已完成（同步等待）。\n\n${resultTask.resultSummary ?? ''}\n\n`
        + '请根据以上结果继续后续步骤。'
      );
    }

    if (!svc || !targetTaskId || typeof this.manager.spawnSync !== 'function') {
      return this.manager.spawn(opts);
    }

    void svc.runTaskWithResult(targetTaskId, this.manager.spawnSync(opts)).catch((err) => {
      void svc.safeFailTask(targetTaskId, err instanceof Error ? err.message : String(err));
    });

    return (
      `任务已创建：#${targetTaskId}${targetRunId ? ` (run ${targetRunId})` : ''}\n`
      + `status: assigned\n`
      + '结果会回写到 OrchestrationKernel，可用 orchestration_status 或 Console 查看。'
    );
  }
}

export function createSpawnTaskTool(
  commMessage: Message,
  manager: SubagentSystem,
  options?: SpawnTaskToolOptions,
): AgentTool {
  return new SpawnTaskBuiltinTool(commMessage, manager, options).toTool() as AgentTool;
}
