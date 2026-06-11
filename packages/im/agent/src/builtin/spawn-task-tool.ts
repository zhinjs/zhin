/**
 * spawn_task — 主会话将耗时任务派给后台子 agent（与 issue #396 对齐）
 */
import type { AgentTool, Message, Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import type { SubagentManager, SubagentOrigin } from '../subagent.js';
import type { SubagentContextMode } from '../subagent-preset.js';
import { getAgentDispatcher } from '../orchestrator/agent-dispatcher.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { executeRemoteOrchestrationTask } from '../orchestrator/remote-task-executor.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const SPAWN_TASK_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description: '要交给子 agent 完成的任务描述（尽量详细，包含目标、范围、期望输出）',
    },
    label: {
      type: 'string',
      description: '任务的简短标签（用于显示，可选）',
    },
    agent: {
      type: 'string',
      description: '子 agent 名（须在 ai.agents 与 agents/<name>.agent.md 中定义；默认 subtask 工具集）',
    },
    wait: {
      type: 'boolean',
      description:
        '为 true 时同步等待子 agent 完成并将结果返回给你',
    },
    context: {
      type: 'string',
      enum: ['fork', 'fresh'],
      description:
        '上下文模式：fork 注入主会话最近消息快照；fresh 空上下文。缺省按 *.agent.md 或角色默认',
    },
    run_id: {
      type: 'string',
      description: '硬编排 run ID（与 task_id 配合使用）',
    },
    task_id: {
      type: 'string',
      description: '硬编排任务 ID（须先 orchestration_add_task 或 template 预置）',
    },
  },
  required: ['task'],
};

export function originFromMessage(message: Message): SubagentOrigin {
  return { message };
}

export class SpawnTaskBuiltinTool extends BuiltinBaseTool {
  readonly name = 'spawn_task';
  readonly description =
    '将复杂或耗时的任务交给子 agent。默认异步（完成后另条推送）；需同步等待结果时设 wait=true。硬编排模式下须传 run_id+task_id。文生图用 draw，识图用 vision。含图结果日志 preview 为 {image}；wait=true 时勿再发「稍等」。';
  readonly parameters = SPAWN_TASK_PARAMETERS;

  constructor(
    private readonly sessionCommMessage: Message,
    private readonly manager: SubagentManager,
  ) {
    super();
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

    if (orchestrationTaskId) {
      const dispatcher = getAgentDispatcher();
      const orch = getOrchestrationService();
      if (orch && runId) {
        await dispatcher.hydrateRun(runId);
        const run = await orch.repositoryHandle.getRun(runId);
        const { isMissionsTemplate } = await import('../orchestrator/mission-state.js');
        if (run && isMissionsTemplate(run)) {
          return `${run.template} 由 MissionRunner 自动推进，请勿手动 spawn_task`;
        }
      }
      const gate = await dispatcher.canExecuteMissions(orchestrationTaskId);
      if (!gate.canExecute) {
        return `无法执行 task ${orchestrationTaskId}：${gate.reason ?? '门禁未通过'}`;
      }
      const agentTask = dispatcher.getTask(orchestrationTaskId);
      if (agentTask?.executorKind === 'remote') {
        const remoteResult = await executeRemoteOrchestrationTask(orchestrationTaskId);
        if (args.wait === true) {
          return remoteResult.message;
        }
        return remoteResult.message;
      }
    }

    const origin = originFromMessage(this.sessionCommMessage);
    const labelStr = typeof label === 'string' ? label : undefined;
    const agentOpt = typeof agentName === 'string' && agentName.trim() ? agentName.trim() : undefined;
    const contextMode: SubagentContextMode | undefined =
      args.context === 'fork' || args.context === 'fresh' ? args.context : undefined;
    const orchestrationRole = orchestrationTaskId
      ? getAgentDispatcher().getTask(orchestrationTaskId)?.role
      : undefined;
    const opts = {
      task,
      label: labelStr,
      origin,
      agent: agentOpt,
      role: orchestrationRole,
      notifyContext: this.sessionCommMessage,
      contextMode,
      orchestrationTaskId: orchestrationTaskId || undefined,
    };

    if (args.wait === true) {
      const result = await this.manager.spawnSync(opts);
      return (
        `子任务${labelStr ? `「${labelStr}」` : ''}已完成（同步等待）。\n\n${result}\n\n`
        + '请根据以上结果继续后续步骤。'
      );
    }

    return this.manager.spawn(opts);
  }
}

export function createSpawnTaskTool(
  commMessage: Message,
  manager: SubagentManager,
): AgentTool {
  return new SpawnTaskBuiltinTool(commMessage, manager).toTool() as AgentTool;
}
