/**
 * spawn_task — 主会话将耗时任务派给后台子 agent（与 issue #396 对齐）
 */
import { type Message, type ToolParametersSchema, type ToolResult } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import type { SubagentSystem, SubagentOrigin } from '../subagent/index.js';
import type { SubagentContextMode } from '../subagent-preset.js';
import { getActiveDeferredTurnController } from '../tool-catalog/deferred-turn-controller.js';
import {
  assertSpawnAgentAllowed,
  type PermissionTaskRules,
} from './permission-task.js';
export interface SpawnTaskToolOptions {
  /** 经 permission.task 过滤后可展示的子 agent 名 */
  allowedAgents?: string[];
  permissionTaskRules?: PermissionTaskRules;
}

function buildSpawnTaskDescription(allowedAgents?: string[]): string {
  const lines = [
    'Delegate complex or long-running work to a temporary chat sub-agent. This does not create or update a durable Workroom Task. It runs asynchronously and returns an ephemeral subtask ID; set wait=true to block until completion.',
    'You may issue multiple spawn_task calls in one assistant turn when subtasks are independent (prefer parallel spawn for independent work).',
    'Use draw for text-to-image and vision for image understanding. Image results log preview as {image}; when wait=true, do not tell the user to wait.',
  ];
  if (allowedAgents?.length) {
    lines.push(`Allowed sub-agent types: ${allowedAgents.join(', ')}.`);
  } else {
    lines.push('Allowed sub-agent types are defined in ai.agents and agents/<name>/agent.json.');
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
      description: 'Sub-agent name (must exist in ai.agents and agents/<name>/agent.json; default subtask toolset).',
    },
    wait: {
      type: 'boolean',
      description: 'If true, wait synchronously for the sub-agent to finish and return its result.',
    },
    context: {
      type: 'string',
      enum: ['fork', 'fresh'],
      description:
        'Context mode: fork injects recent parent session messages; fresh starts empty. Default follows agent.json or role.',
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
  },
  required: ['task'],
};

export function originFromMessage(message: Message): SubagentOrigin {
  return { message };
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
  return items.length > 0 ? items : undefined;
}

export class SpawnTaskTool {
  readonly name = 'spawn_task';
  readonly description: string;
  readonly parameters = SPAWN_TASK_PARAMETERS;
  private readonly permissionTaskRules?: PermissionTaskRules;

  constructor(
    private readonly sessionCommMessage: Message,
    private readonly manager: SubagentSystem,
    options?: SpawnTaskToolOptions,
  ) {
    this.description = buildSpawnTaskDescription(options?.allowedAgents);
    this.permissionTaskRules = options?.permissionTaskRules;
  }

  definition(): AgentTool {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      source: 'builtin:context',
      tags: ['agent', 'async', 'task', '后台', '子任务'],
      keywords: ['后台', '异步', '子任务', 'spawn', 'background', '并行', '独立处理'],
      execute: (args) => this.execute(args),
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task;
    const label = args.label;
    const agentName = args.agent;
    if (typeof task !== 'string' || !task) {
      return '请提供任务描述';
    }

    const origin = originFromMessage(this.sessionCommMessage);
    const labelStr = typeof label === 'string' ? label : undefined;
    const agentOpt = typeof agentName === 'string' && agentName.trim() ? agentName.trim() : undefined;
    const permissionError = assertSpawnAgentAllowed(agentOpt, this.permissionTaskRules);
    if (permissionError) return permissionError;
    const contextMode: SubagentContextMode | undefined =
      args.context === 'fork' || args.context === 'fresh' ? args.context : undefined;
    const requestedTools = parseStringArray(args.tools);
    const requestedSkills = parseStringArray(args.skills);
    const deferredController = getActiveDeferredTurnController();
    const parentSessionLoaded = deferredController?.loadedToolNames();
    const parentLoadedSkills = deferredController?.snapshot().loadedSkills;

    const opts = {
      task,
      label: labelStr,
      origin,
      agent: agentOpt,
      notifyContext: this.sessionCommMessage,
      contextMode,
      requestedTools,
      requestedSkills,
      parentSessionLoaded,
      parentLoadedSkills,
    };

    if (args.wait === true) {
      if (typeof this.manager.spawnSync !== 'function') {
        return this.manager.spawn(opts);
      }
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
  manager: SubagentSystem,
  options?: SpawnTaskToolOptions,
): AgentTool {
  return new SpawnTaskTool(
    commMessage,
    manager,
    options,
  ).definition();
}
