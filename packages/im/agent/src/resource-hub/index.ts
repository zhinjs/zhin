/**
 * AgentResourceHub — the central AI capability resource registry.
 *
 * Manages five resource types:
 *   - tools: AgentTool / ZhinTool / Tool
 *   - skills: Skill
 *   - subagents: SubAgentDef / AgentPreset
 *   - mcps: McpServerEntry (MCP client connections)
 *   - hooks: AIHook (AI lifecycle hooks)
 *
 * Each resource type supports common (all agents) vs specialized (specific agent).
 *
 * Usage:
 *   const agent = root.inject('agent') as AgentResourceHub;
 *   agent.addTool(myTool);
 *   agent.addSkill(mySkill, { agentId: 'cs-bot' });
 */

import type { AgentTool } from '@zhin.js/ai';
import { ToolRegistry, type ToolLike } from './tool-registry.js';
import { SkillRegistry } from './skill-registry.js';
import { SubAgentRegistry } from './subagent-registry.js';
import { McpRegistry, type McpConnection } from './mcp-registry.js';
import { HookRegistry, createAIHookEvent } from './hook-registry.js';
import { createAgentStreamBus, type AgentStreamBus } from '../event/agent-stream-bus.js';
import { createHookStreamSink } from '../event/hook-stream-sink.js';
import { ToolApprovalOnceStore } from '../tool/tool-approval-once-store.js';
import type {
  ResourceScope,
  Skill,
  SubAgentDef,
  AgentPreset,
  Tool,
  McpServerEntry,
  AIHook,
  AIHookEvent,
  AIHookEventType,
} from './types.js';

/** @public @experimental Plugin-facing generation-scoped Agent capability registry. */
export class AgentResourceHub {
  /** @internal Runtime-owned storage; use the AgentResourceHub methods below. */
  readonly tools = new ToolRegistry();
  /** @internal Runtime-owned storage; use the AgentResourceHub methods below. */
  readonly skills = new SkillRegistry();
  /** @internal Runtime-owned storage; use the AgentResourceHub methods below. */
  readonly subagents = new SubAgentRegistry();
  /** @internal Runtime-owned storage; use the AgentResourceHub methods below. */
  readonly mcps = new McpRegistry();
  /** @internal Runtime-owned storage; use the AgentResourceHub methods below. */
  readonly hooks = new HookRegistry();
  /** @internal Runtime event transport. */
  readonly agentStreamBus: AgentStreamBus;
  /** @internal Runtime approval state. */
  readonly approvalOnce = new ToolApprovalOnceStore();

  /** @internal Created and disposed by the generation-owned Agent Host. */
  constructor() {
    this.agentStreamBus = createAgentStreamBus();
    this.agentStreamBus.registerSink(createHookStreamSink(this.hooks));
  }

  // ── Tool shortcuts ──

  addTool(tool: Tool | AgentTool | ToolLike, scope?: ResourceScope, source?: string): () => void {
    return this.tools.addTool(tool, scope, source);
  }

  removeTool(name: string, scope?: ResourceScope): boolean {
    return this.tools.removeTool(name, scope);
  }

  // ── Skill shortcuts ──

  addSkill(skill: Skill, scope?: ResourceScope, source?: string): () => void {
    return this.skills.add(skill, scope, source);
  }

  removeSkill(name: string, scope?: ResourceScope): boolean {
    return this.skills.remove(name, scope);
  }

  // ── SubAgent shortcuts ──

  addSubAgent(def: SubAgentDef, scope?: ResourceScope, source?: string): () => void {
    return this.subagents.add(def, scope, source);
  }

  removeSubAgent(name: string, scope?: ResourceScope): boolean {
    return this.subagents.remove(name, scope);
  }

  addAgentPreset(preset: AgentPreset, scope?: ResourceScope, source?: string): () => void {
    return this.subagents.addPreset(preset, scope, source);
  }

  // ── MCP shortcuts ──

  addMcp(config: McpServerEntry, scope?: ResourceScope, source?: string): () => void {
    return this.mcps.add(config, scope, source);
  }

  removeMcp(name: string, scope?: ResourceScope): boolean {
    return this.mcps.remove(name, scope);
  }

  async connectMcp(name: string): Promise<McpConnection> {
    return this.mcps.connect(name);
  }

  disconnectMcp(name: string): void {
    this.mcps.disconnect(name);
  }

  // ── Hook shortcuts ──

  addHook(hook: AIHook, scope?: ResourceScope, source?: string): () => void {
    return this.hooks.add(hook, scope, source);
  }

  removeHook(name: string, scope?: ResourceScope): boolean {
    return this.hooks.remove(name, scope);
  }

  async triggerHook(event: AIHookEvent, agentId?: string): Promise<void> {
    return this.hooks.trigger(event, agentId);
  }

  createHookEvent(type: AIHookEventType, action: string, sessionId?: string, context?: Record<string, unknown>): AIHookEvent {
    return createAIHookEvent(type, action, sessionId, context);
  }

  // ── Query shortcuts ──

  getToolsForAgent(agentId?: string): AgentTool[] {
    return agentId ? this.tools.getForAgent(agentId) : this.tools.getAll();
  }

  getSkillsForAgent(agentId?: string): Skill[] {
    return agentId ? this.skills.getForAgent(agentId) : this.skills.getAll();
  }

  getSubAgentsForAgent(agentId?: string): SubAgentDef[] {
    return agentId ? this.subagents.getForAgent(agentId) : this.subagents.getAll();
  }

  getHooksForEvent(event: string, agentId?: string): AIHook[] {
    return this.hooks.getForEvent(event, agentId);
  }

  // ── Lifecycle ──

  /** @internal Generation Host lifecycle; plugins dispose only their returned registrations. */
  dispose(): void {
    this.tools.dispose();
    this.skills.dispose();
    this.subagents.dispose();
    this.mcps.dispose();
    this.hooks.dispose();
    this.approvalOnce.clear();
  }
}

// Re-export everything consumers need
export { ResourceRegistry } from './resource-registry.js';
export { ToolRegistry, ZhinTool, isZhinTool, defineTool, extractParamInfo, canAccessTool } from './tool-registry.js';
export type { ToolInput } from './tool-registry.js';
export { normalizeTool, sharedToolSelection } from './tool-selection.js';
export type { CollectToolsContext } from './tool-selection.js';
export { SkillRegistry } from './skill-registry.js';
export { SubAgentRegistry } from './subagent-registry.js';
export { McpRegistry } from './mcp-registry.js';
export type { McpConnection } from './mcp-registry.js';
export { HookRegistry, createAIHookEvent } from './hook-registry.js';
export * from './types.js';
export * from './role-configs.js';
