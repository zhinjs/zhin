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
  };
}

export class SpawnTaskBuiltinTool extends BuiltinBaseTool {
  readonly name = 'spawn_task';
  readonly description =
    '将复杂或耗时的任务交给后台子 agent 异步处理。子 agent 拥有文件读写、Shell、网络搜索等能力，完成后会自动通知用户。适用于需要多步操作的文件处理、代码分析、数据收集等任务。';
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
    if (typeof task !== 'string' || !task) {
      return '请提供任务描述';
    }

    const origin = originFromToolContext(this.sessionContext);
    const labelStr = typeof label === 'string' ? label : undefined;

    return this.manager.spawn({ task, label: labelStr, origin });
  }
}

export function createSpawnTaskTool(context: ToolContext, manager: SubagentManager): AgentTool {
  return new SpawnTaskBuiltinTool(context, manager).toTool() as AgentTool;
}
