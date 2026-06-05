/**
 * spawn_task — 主会话将耗时任务派给后台子 agent（与 issue #396 对齐）
 */
import type { AgentTool, Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import type { SubagentManager, SubagentOrigin } from '../subagent.js';
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
  },
  required: ['task'],
};

export function originFromToolContext(context: ToolContext): SubagentOrigin {
  return {
    platform: context.platform || '',
    botId: context.botId || '',
    senderId: context.senderId || '',
    sceneId: context.sceneId || '',
    sceneType: context.message?.$channel?.type || 'private',
    messageId: context.messageId || context.message?.$id,
  };
}

export class SpawnTaskBuiltinTool extends BuiltinBaseTool {
  readonly name = 'spawn_task';
  readonly description =
    '将复杂或耗时的任务交给子 agent。默认异步（完成后另条推送）；需同步等待结果时设 wait=true。文生图用 draw，识图用 vision。含图结果日志 preview 为 {image}；wait=true 时勿再发「稍等」。';
  readonly parameters = SPAWN_TASK_PARAMETERS;

  constructor(
    private readonly sessionContext: ToolContext,
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

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const task = args.task;
    const label = args.label;
    const agentName = args.agent;
    if (typeof task !== 'string' || !task) {
      return '请提供任务描述';
    }

    const origin = originFromToolContext(this.sessionContext);
    const labelStr = typeof label === 'string' ? label : undefined;
    const agentOpt = typeof agentName === 'string' && agentName.trim() ? agentName.trim() : undefined;
    const opts = {
      task,
      label: labelStr,
      origin,
      agent: agentOpt,
      notifyContext: this.sessionContext,
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

export function createSpawnTaskTool(context: ToolContext, manager: SubagentManager): AgentTool {
  return new SpawnTaskBuiltinTool(context, manager).toTool() as AgentTool;
}
