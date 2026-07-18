/**
 * Capability Ingress — Feature → Agent Orchestrator (ADR 0042)
 *
 * Load filters reuse platforms / scopes / permissions via `canAccessTool`
 * (same vocabulary as Tool Selection). Cache keys use the same message
 * projections `canAccessTool` reads — not a second authoring vocabulary.
 *
 * Ownership: only one on-demand set is live at a time (`lastCacheKey`);
 * a cache miss purges previous owned entries then reloads. While a turn is
 * still in flight (holding the previous projection), the purge is deferred
 * until that turn releases its lease, so a concurrent turn never loses the
 * tools it is executing with.
 *
 * Named `FeatureCapabilityIngress` to disambiguate from the Plugin Runtime
 * `CapabilityIngress` exported by `@zhin.js/agent/runtime`.
 */

import {
  canAccessTool,
  senderRolesFromMessage,
  type Message,
  type Tool as CoreTool,
  type Skill as CoreSkill,
  type ToolFeature,
  type SkillFeature,
} from '@zhin.js/core';
import { isBuiltinToolSource } from '@zhin.js/ai';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { Skill, Tool, AgentPreset, McpServerEntry } from '../orchestrator/types.js';
import type { AgentFeature } from '../features/agent-feature.js';
import type { MCPFeature } from '../features/mcp-feature.js';
import type { ResolvedAgentBinding } from '../config/types.js';

export interface CapabilityFeatureBundle {
  tools?: ToolFeature | null;
  skills?: SkillFeature | null;
  agents?: AgentFeature | null;
  mcps?: MCPFeature | null;
}

export interface IngressTurnContext {
  binding: ResolvedAgentBinding;
  message: Message;
}

interface IngressOwned {
  tools: Set<string>;
  skills: Set<string>;
  agents: Set<string>;
  mcps: Set<string>;
}

function toolToOrchestrator(tool: CoreTool): Tool {
  return tool as unknown as Tool;
}

function skillToOrchestrator(skill: CoreSkill): Skill {
  return {
    name: skill.name,
    description: skill.description,
    tools: (skill.tools ?? []).map(toolToOrchestrator),
    platforms: skill.platforms,
    keywords: skill.keywords,
    tags: skill.tags,
    pluginName: skill.pluginName,
    filePath: skill.filePath,
    always: skill.always,
  };
}

/** Skill visibility via same platforms/scopes/permissions contract as Tool. */
function canAccessSkill(skill: CoreSkill, message: Message): boolean {
  return canAccessTool(
    {
      name: skill.name,
      description: skill.description,
      parameters: { type: 'object', properties: {} },
      execute: () => undefined,
      platforms: skill.platforms,
    },
    message,
  );
}

function toolAccessMeta(tool: CoreTool): string {
  return [
    tool.name,
    tool.source ?? '',
    (tool.platforms ?? []).join(','),
    (tool.scopes ?? []).join(','),
    (tool.permissions ?? []).join(','),
  ].join(':');
}

function featureFingerprint(features: CapabilityFeatureBundle): string {
  const tools = (features.tools?.getAll() ?? []).map(toolAccessMeta).sort().join('+');
  const skills = (features.skills?.getAll() ?? [])
    .map((s) => `${s.name}:${(s.platforms ?? []).join(',')}`)
    .sort()
    .join('+');
  const agents = (features.agents?.getAll() ?? []).map((a) => a.name).sort().join('+');
  const mcps = (features.mcps?.getAll() ?? []).map((m) => m.name).sort().join('+');
  const agentEpoch = features.agents?.epoch ?? 0;
  const mcpEpoch = features.mcps?.epoch ?? 0;
  return `t:${tools}|s:${skills}|a:${agents}@${agentEpoch}|m:${mcps}@${mcpEpoch}`;
}

/**
 * Fingerprint of message fields that `canAccessTool` consults
 * (platforms ← $adapter, scopes ← $channel.type, permissions ← sender roles).
 */
function canAccessProjectionKey(message: Message): string {
  const platformsProjection = String(message.$adapter ?? '');
  const scopesProjection = String(message.$channel?.type ?? 'private');
  const permissionsProjection = [...senderRolesFromMessage(message)].map(String).sort().join(',');
  return `p=${platformsProjection}|s=${scopesProjection}|perm=${permissionsProjection}`;
}

function buildTurnCacheKey(ctx: IngressTurnContext, fingerprint: string): string {
  const mcpAllow = [...(ctx.binding.mcpServers ?? [])].map(String).sort().join(',');
  return `${ctx.binding.name}|mcp=${mcpAllow}|${canAccessProjectionKey(ctx.message)}|${fingerprint}`;
}

function emptyOwned(): IngressOwned {
  return {
    tools: new Set(),
    skills: new Set(),
    agents: new Set(),
    mcps: new Set(),
  };
}

function purgeOwned(
  orchestrator: AgentOrchestrator,
  owned: IngressOwned,
  retained: IngressOwned = emptyOwned(),
): void {
  for (const name of owned.tools) {
    if (!retained.tools.has(name)) orchestrator.removeTool(name);
  }
  for (const name of owned.skills) {
    if (!retained.skills.has(name)) orchestrator.removeSkill(name);
  }
  for (const name of owned.agents) {
    if (retained.agents.has(name)) continue;
    // removePreset also drops the SubAgentDef resource
    orchestrator.subagents.removePreset(name);
  }
  for (const name of owned.mcps) {
    if (!retained.mcps.has(name)) orchestrator.removeMcp(name);
  }
}

function mergeOwned(target: IngressOwned, source: IngressOwned): void {
  for (const name of source.tools) target.tools.add(name);
  for (const name of source.skills) target.skills.add(name);
  for (const name of source.agents) target.agents.add(name);
  for (const name of source.mcps) target.mcps.add(name);
}

/** Result of ensureForTurn; `release()` must be called when the turn ends. */
export interface IngressTurnLease {
  readonly tools: number;
  readonly skills: number;
  readonly agents: number;
  readonly mcps: number;
  readonly cacheHit: boolean;
  /** End the turn; a deferred purge of the previous projection may run here. */
  release(): void;
}

interface RetiredProjection {
  owned: IngressOwned;
  inFlight: number;
}

export class FeatureCapabilityIngress {
  /** Live on-demand set key; ownership is single-slot (purge on miss). */
  private lastCacheKey: string | null = null;
  private owned = emptyOwned();
  /** Turns currently executing against the live projection. */
  private inFlight = 0;
  /** Previous projections kept alive until their in-flight turns release. */
  private retired = new Map<string, RetiredProjection>();
  private staleCounter = 0;
  private coreToolNames = new Set<string>();

  /** Test / hot-reload: drop cache so next ensureForTurn re-loads. */
  invalidate(): void {
    this.lastCacheKey = null;
  }

  /**
   * Boot / refresh: load reserved/builtin tools from ToolFeature into Orchestrator.
   * Returns count of newly tracked builtins (net adds this call).
   */
  ensureCore(
    orchestrator: AgentOrchestrator,
    features: CapabilityFeatureBundle,
  ): { tools: number } {
    let added = 0;
    const seen = new Set<string>();
    for (const tool of features.tools?.getAll() ?? []) {
      if (!isBuiltinToolSource(tool.source)) continue;
      seen.add(tool.name);
      const isNew = !this.coreToolNames.has(tool.name);
      orchestrator.addTool(toolToOrchestrator(tool), undefined, tool.source ?? 'builtin');
      this.coreToolNames.add(tool.name);
      if (isNew) added++;
    }
    for (const name of [...this.coreToolNames]) {
      if (seen.has(name)) continue;
      orchestrator.removeTool(name);
      this.coreToolNames.delete(name);
    }
    return { tools: added };
  }

  /**
   * Inbound: if cache miss, purge previous on-demand set then load Feature
   * capabilities that pass canAccessTool / canAccessSkill for this message.
   * MCP entries are limited to `binding.mcpServers` (empty → none).
   *
   * Concurrency: the returned lease must be released when the turn ends.
   * While any turn is in flight, a cache miss retires the previous
   * projection instead of purging it; the purge runs when the last turn
   * holding that projection releases its lease.
   */
  ensureForTurn(
    orchestrator: AgentOrchestrator,
    features: CapabilityFeatureBundle,
    ctx: IngressTurnContext,
  ): IngressTurnLease {
    const fp = featureFingerprint(features);
    const key = buildTurnCacheKey(ctx, fp);
    if (this.lastCacheKey === key) {
      this.inFlight++;
      return {
        tools: 0,
        skills: 0,
        agents: 0,
        mcps: 0,
        cacheHit: true,
        release: () => this.#releaseTurn(orchestrator, key),
      };
    }

    // Cache miss: a turn still executing against the live projection keeps
    // its entries; retire the projection and purge once it drains.
    if (this.inFlight > 0) {
      const retiredKey = this.lastCacheKey ?? `stale-${this.staleCounter++}`;
      this.retired.set(retiredKey, { owned: this.owned, inFlight: this.inFlight });
    } else {
      purgeOwned(orchestrator, this.owned);
    }
    this.owned = emptyOwned();
    this.inFlight = 0;

    let tools = 0;
    let skills = 0;
    let agents = 0;
    let mcps = 0;

    const allowedMcp = new Set(
      (ctx.binding.mcpServers ?? []).map((s) => String(s).trim()).filter(Boolean),
    );

    for (const tool of features.tools?.getAll() ?? []) {
      if (isBuiltinToolSource(tool.source)) continue;
      if (!canAccessTool(tool, ctx.message)) continue;
      orchestrator.addTool(toolToOrchestrator(tool), undefined, tool.source ?? 'feature');
      this.owned.tools.add(tool.name);
      tools++;
    }

    for (const skill of features.skills?.getAll() ?? []) {
      if (!canAccessSkill(skill, ctx.message)) continue;
      const orchSkill = skillToOrchestrator(skill);
      orchSkill.tools = orchSkill.tools.filter((t) =>
        canAccessTool(t as unknown as CoreTool, ctx.message),
      );
      orchestrator.addSkill(orchSkill, undefined, skill.pluginName);
      this.owned.skills.add(skill.name);
      skills++;
    }

    for (const preset of features.agents?.getAll() ?? []) {
      orchestrator.addAgentPreset(
        preset as AgentPreset,
        undefined,
        preset.pluginName ?? 'feature',
      );
      this.owned.agents.add(preset.name);
      agents++;
    }

    for (const entry of features.mcps?.getAll() ?? []) {
      if (!allowedMcp.has(entry.name)) continue;
      const { pluginName: _p, ...mcp } = entry;
      orchestrator.addMcp(mcp as McpServerEntry, undefined, entry.pluginName ?? 'feature');
      this.owned.mcps.add(entry.name);
      mcps++;
    }

    this.lastCacheKey = key;
    this.inFlight = 1;
    return {
      tools,
      skills,
      agents,
      mcps,
      cacheHit: false,
      release: () => this.#releaseTurn(orchestrator, key),
    };
  }

  #releaseTurn(orchestrator: AgentOrchestrator, key: string): void {
    if (key === this.lastCacheKey) {
      // Live projection: keep the cache even when no turn is in flight.
      this.inFlight = Math.max(0, this.inFlight - 1);
      return;
    }
    const retired = this.retired.get(key);
    if (!retired) return;
    retired.inFlight--;
    if (retired.inFlight > 0) return;
    this.retired.delete(key);
    // Skip names the live projection (or another still-active retired
    // projection) re-registered under the same name.
    const retained = emptyOwned();
    mergeOwned(retained, this.owned);
    for (const other of this.retired.values()) {
      if (other.inFlight > 0) mergeOwned(retained, other.owned);
    }
    purgeOwned(orchestrator, retired.owned, retained);
  }
}

export function createFeatureCapabilityIngress(): FeatureCapabilityIngress {
  return new FeatureCapabilityIngress();
}
