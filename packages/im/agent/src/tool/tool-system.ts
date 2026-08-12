import type { AgentTool } from '@zhin.js/ai';
import { type PreExecuteResult, runPreExecutableTools } from './pre-exec.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { Tool } from '../orchestrator/types.js';
import { createSpawnTaskTool } from '../builtin/spawn-task-tool.js';
import { filterAgentsForSpawnDescription } from '../spawn/permission-task.js';
import type { ToolFilter, ToolSource, ToolSystemConfig } from './contracts.js';
import {
  BuiltinToolSource,
  DedupeToolFilter,
  ExternalToolSource,
  McpToolSource,
  RegisteredToolSource,
  SkillToolSource,
  type CollectToolsContext,
} from './sources.js';
import {
  resolveAgentToolsForTurn,
  type ResolvedToolsForTurn,
} from './deferred-resolution.js';
export type { CollectToolsContext } from './sources.js';
export type { ResolvedToolsForTurn } from './deferred-resolution.js';

export interface CollectToolsForTurnInput extends CollectToolsContext {
  host: ZhinAgentPrivate;
  spawnableAgentNames?: string[];
}

/** 每 turn 独立 Source 列表，不 mutate 共享 ToolSystem 实例。 */
export function createDefaultToolSources(context: CollectToolsContext): ToolSource[] {
  return [
    new ExternalToolSource(context.externalTools),
    new SkillToolSource(context.skillRegistry),
    new RegisteredToolSource(context.externalRegistered),
    new BuiltinToolSource(),
    new McpToolSource(),
  ];
}

export function createToolSystem(config: ToolSystemConfig = {}): ToolSystem {
  return new ToolSystem(config);
}

export class ToolSystem {
  private readonly customSources: ToolSource[] = [];
  private readonly filters: ToolFilter[] = [];

  constructor(_config: ToolSystemConfig = {}) {
    this.addFilter(new DedupeToolFilter());
  }

  addSource(source: ToolSource): void {
    this.customSources.push(source);
    this.customSources.sort((a, b) => b.priority - a.priority);
  }

  addFilter(filter: ToolFilter): void {
    this.filters.push(filter);
  }

  async collectTools(context: CollectToolsContext, sources?: ToolSource[]): Promise<AgentTool[]> {
    const activeSources = sources ?? [
      ...createDefaultToolSources(context),
      ...this.customSources,
    ];
    let tools: AgentTool[] = [];
    for (const source of activeSources) {
      tools.push(...(await source.collectTools(context)));
    }
    for (const filter of this.filters) {
      tools = filter.filter(tools, { message: context.message });
    }
    return tools;
  }

  async collectForTurn(input: CollectToolsForTurnInput): Promise<AgentTool[]> {
    const { host, spawnableAgentNames, ...ctx } = input;
    const tools = await this.collectTools(ctx, createDefaultToolSources(ctx));

    if (host.subagentSystem && spawnableAgentNames) {
      const permissionTask = host.activeBinding?.permission?.task;
      tools.push(createSpawnTaskTool(ctx.message, host.subagentSystem, {
        allowedAgents: filterAgentsForSpawnDescription(spawnableAgentNames, permissionTask),
        permissionTaskRules: permissionTask,
      }));
    }

    return tools;
  }

  async resolveForTurn(
    host: ZhinAgentPrivate,
    allTools: AgentTool[],
    sessionId: string,
  ): Promise<ResolvedToolsForTurn> {
    return resolveAgentToolsForTurn(host, allTools, sessionId);
  }
}

export interface ToolRunPlan {
  preExecTools: AgentTool[];
  preExecution: PreExecuteResult;
  hasNonPreExecTools: boolean;
  mode: 'chat' | 'pre-exec-fast-path' | 'agent';
}

export async function planToolRun(
  tools: AgentTool[],
  timeoutMs: number,
): Promise<ToolRunPlan> {
  const preExecution = await runPreExecutableTools(tools, timeoutMs);
  const hasNonPreExecTools = tools.some(tool => !tool.preExecutable);
  return {
    preExecTools: preExecution.tools,
    preExecution,
    hasNonPreExecTools,
    mode: tools.length === 0
      ? 'chat'
      : (!hasNonPreExecTools && preExecution.data ? 'pre-exec-fast-path' : 'agent'),
  };
}

export function buildPreExecFastPathPrompt(persona: string, preData: string): string {
  return `${persona}

Pre-fetched data (from user's question):
${preData}

Answer the user's question based on the data above. Be clear and concise; use emoji when appropriate.`;
}

/** Stamps the owning generation so ToolRuntime can reject retired-generation tools. */
export function stampToolGeneration<T extends { generation?: number }>(
  tools: T[],
  generation: number,
): T[] {
  for (const tool of tools) tool.generation = generation;
  return tools;
}

/** 无 per-turn 可变 state；并发 collectForTurn 安全。 */
export const defaultToolSystem = createToolSystem();
