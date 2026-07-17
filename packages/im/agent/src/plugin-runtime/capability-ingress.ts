import type { FeatureId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  AgentIndex,
  agentFeatureId,
  type AgentDescriptor,
} from '@zhin.js/agent-feature';
import {
  McpIndex,
  mcpFeatureId,
  type McpDescriptor,
  type McpToolDescriptor,
} from '@zhin.js/mcp-feature';
import {
  SkillIndex,
  skillFeatureId,
  type SkillDescriptor,
} from '@zhin.js/skill';
import {
  ToolIndex,
  toolFeatureId,
  type ToolDescriptor,
} from '@zhin.js/tool';

export interface ToolCapability extends ToolDescriptor {
  execute<TInput = unknown, TResult = unknown>(input: TInput): Promise<TResult>;
}

export interface McpCapability extends McpDescriptor {
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool<TResult = unknown>(tool: string, input: unknown): Promise<TResult>;
}

export interface AgentCapabilities {
  readonly generation: number;
  readonly owner: PluginId;
  readonly tools: readonly ToolCapability[];
  readonly skills: readonly SkillDescriptor[];
  readonly agents: readonly AgentDescriptor[];
  readonly mcp: readonly McpCapability[];
}

export class CapabilityIngress {
  read(
    snapshot: RuntimeSnapshot,
    owner: PluginId,
    isActive: () => boolean = () => true,
  ): AgentCapabilities {
    if (!snapshot.tree.has(owner)) throw new Error(`Unknown Agent capability owner: ${owner}`);
    const tools = projection(snapshot, toolFeatureId, ToolIndex);
    const mcp = projection(snapshot, mcpFeatureId, McpIndex);
    return Object.freeze({
      generation: snapshot.generation,
      owner,
      tools: bindTools(tools, owner, isActive),
      skills: Object.freeze([
        ...(projection(snapshot, skillFeatureId, SkillIndex)?.visible(owner) ?? []),
      ]),
      agents: Object.freeze([
        ...(projection(snapshot, agentFeatureId, AgentIndex)?.visible(owner) ?? []),
      ]),
      mcp: bindMcp(mcp, owner, isActive),
    });
  }
}

function bindTools(
  index: ToolIndex | undefined,
  owner: PluginId,
  isActive: () => boolean,
): readonly ToolCapability[] {
  if (!index) return Object.freeze([]);
  return Object.freeze(index.visible(owner).map((descriptor) => Object.freeze({
    ...descriptor,
    execute: <TInput, TResult>(input: TInput) => {
      assertActive(isActive);
      return index.execute<TInput, TResult>(owner, descriptor.name, input);
    },
  })));
}

function bindMcp(
  index: McpIndex | undefined,
  owner: PluginId,
  isActive: () => boolean,
): readonly McpCapability[] {
  if (!index) return Object.freeze([]);
  return Object.freeze(index.visible(owner).map((descriptor) => Object.freeze({
    ...descriptor,
    listTools: () => {
      assertActive(isActive);
      return index.listTools(owner, descriptor.name);
    },
    callTool: <TResult>(tool: string, input: unknown) => {
      assertActive(isActive);
      return index.callTool<TResult>(owner, descriptor.name, tool, input);
    },
  })));
}

function assertActive(isActive: () => boolean): void {
  if (!isActive()) throw new Error('Agent capability turn scope has ended');
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: FeatureId,
  constructor: { readonly prototype: T },
): T | undefined {
  const value = snapshot.projections.get(id);
  return value
    && typeof value === 'object'
    && Object.prototype.isPrototypeOf.call(constructor.prototype, value)
    ? value as T
    : undefined;
}
