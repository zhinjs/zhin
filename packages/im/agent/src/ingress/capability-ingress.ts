/**
 * Capability Ingress — Feature → Agent Resource Hub (ADR 0042)
 *
 * Load filters reuse platforms / scopes / permissions via `canAccessTool`
 * (same vocabulary as Tool Selection). Cache keys use the same message
 * projections `canAccessTool` reads — not a second authoring vocabulary.
 *
 * Ownership: only one on-demand set is live at a time (`live` projection);
 * a cache miss purges previous owned entries then reloads. While a turn is
 * still in flight (holding the previous projection), the purge is deferred
 * until that turn releases its lease, so a concurrent turn never loses the
 * tools it is executing with. Leases release against the projection object
 * they acquired — not the cache key — so an A→B→A key oscillation can never
 * decrement the wrong projection's in-flight count.
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
import type { PermissionHost } from '@zhin.js/permission';
import { isBuiltinToolSource } from '@zhin.js/ai';
import type { AgentResourceHub } from '../resource-hub/index.js';
import type { Skill, Tool, AgentPreset, McpServerEntry } from '../resource-hub/types.js';
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
  host?: PermissionHost | null;
}

interface IngressOwned {
  tools: Set<string>;
  skills: Set<string>;
  agents: Set<string>;
  mcps: Set<string>;
}

function toolToResourceHub(tool: CoreTool): Tool {
  return tool as unknown as Tool;
}

function skillToResourceHub(skill: CoreSkill): Skill {
  return {
    name: skill.name,
    description: skill.description,
    tools: (skill.tools ?? []).map(toolToResourceHub),
    platforms: skill.platforms,
    keywords: skill.keywords,
    tags: skill.tags,
    pluginName: skill.pluginName,
    filePath: skill.filePath,
    always: skill.always,
  };
}

/** Skill visibility via same platforms/scopes/permissions contract as Tool. */
async function canAccessSkill(skill: CoreSkill, message: Message, host?: PermissionHost | null): Promise<boolean> {
  return canAccessTool(
    {
      name: skill.name,
      description: skill.description,
      parameters: { type: 'object', properties: {} },
      execute: () => undefined,
      platforms: skill.platforms,
    },
    message,
    host,
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
  resourceHub: AgentResourceHub,
  owned: IngressOwned,
  retained: IngressOwned = emptyOwned(),
): void {
  for (const name of owned.tools) {
    if (!retained.tools.has(name)) resourceHub.removeTool(name);
  }
  for (const name of owned.skills) {
    if (!retained.skills.has(name)) resourceHub.removeSkill(name);
  }
  for (const name of owned.agents) {
    if (retained.agents.has(name)) continue;
    // removePreset also drops the SubAgentDef resource
    resourceHub.subagents.removePreset(name);
  }
  for (const name of owned.mcps) {
    if (!retained.mcps.has(name)) resourceHub.removeMcp(name);
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

interface Projection {
  /** Cache key this projection was loaded for (mutated to a stale sentinel by invalidate()). */
  key: string;
  owned: IngressOwned;
  inFlight: number;
  /** True once a cache miss retired this projection while turns were in flight. */
  retired: boolean;
}

export class FeatureCapabilityIngress {
  /** Live on-demand projection; ownership is single-slot (purge on miss). */
  private live: Projection | null = null;
  /** Previous projections kept alive until their in-flight turns release. */
  private retired = new Set<Projection>();
  private staleCounter = 0;
  private coreToolNames = new Set<string>();

  /** Test / hot-reload: drop cache so next ensureForTurn re-loads. */
  invalidate(): void {
    // Sentinel key: the next ensureForTurn misses and retires/purges the
    // live projection through the normal path (in-flight leases stay valid
    // because they release against the projection object, not the key).
    if (this.live) this.live.key = `stale-${this.staleCounter++}`;
  }

  /**
   * Boot / refresh: load reserved/builtin tools from ToolFeature into Agent Resource Hub.
   * Returns count of newly tracked builtins (net adds this call).
   */
  ensureCore(
    resourceHub: AgentResourceHub,
    features: CapabilityFeatureBundle,
  ): { tools: number } {
    let added = 0;
    const seen = new Set<string>();
    for (const tool of features.tools?.getAll() ?? []) {
      if (!isBuiltinToolSource(tool.source)) continue;
      seen.add(tool.name);
      const isNew = !this.coreToolNames.has(tool.name);
      resourceHub.addTool(toolToResourceHub(tool), undefined, tool.source ?? 'builtin');
      this.coreToolNames.add(tool.name);
      if (isNew) added++;
    }
    for (const name of [...this.coreToolNames]) {
      if (seen.has(name)) continue;
      resourceHub.removeTool(name);
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
  async ensureForTurn(
    resourceHub: AgentResourceHub,
    features: CapabilityFeatureBundle,
    ctx: IngressTurnContext,
  ): Promise<IngressTurnLease> {
    const fp = featureFingerprint(features);
    const key = buildTurnCacheKey(ctx, fp);
    if (this.live && this.live.key === key) {
      const projection = this.live;
      projection.inFlight++;
      return {
        tools: 0,
        skills: 0,
        agents: 0,
        mcps: 0,
        cacheHit: true,
        release: () => this.#releaseTurn(resourceHub, projection),
      };
    }

    // Cache miss: a turn still executing against the live projection keeps
    // its entries; retire the projection and purge once it drains.
    if (this.live) {
      if (this.live.inFlight > 0) {
        this.live.retired = true;
        this.retired.add(this.live);
      } else {
        purgeOwned(resourceHub, this.live.owned);
      }
    }
    const projection: Projection = { key, owned: emptyOwned(), inFlight: 1, retired: false };
    this.live = projection;

    let tools = 0;
    let skills = 0;
    let agents = 0;
    let mcps = 0;

    const allowedMcp = new Set(
      (ctx.binding.mcpServers ?? []).map((s) => String(s).trim()).filter(Boolean),
    );

    for (const tool of features.tools?.getAll() ?? []) {
      if (isBuiltinToolSource(tool.source)) continue;
      if (!(await canAccessTool(tool, ctx.message, ctx.host))) continue;
      resourceHub.addTool(toolToResourceHub(tool), undefined, tool.source ?? 'feature');
      projection.owned.tools.add(tool.name);
      tools++;
    }

    for (const skill of features.skills?.getAll() ?? []) {
      if (!(await canAccessSkill(skill, ctx.message, ctx.host))) continue;
      const resourceHubSkill = skillToResourceHub(skill);
      const toolAccessResults = await Promise.all(
        resourceHubSkill.tools.map(async (t) => ({
          tool: t,
          allowed: await canAccessTool(t as unknown as CoreTool, ctx.message, ctx.host),
        })),
      );
      resourceHubSkill.tools = toolAccessResults.filter((r) => r.allowed).map((r) => r.tool);
      resourceHub.addSkill(resourceHubSkill, undefined, skill.pluginName);
      projection.owned.skills.add(skill.name);
      skills++;
    }

    for (const preset of features.agents?.getAll() ?? []) {
      resourceHub.addAgentPreset(
        preset as AgentPreset,
        undefined,
        preset.pluginName ?? 'feature',
      );
      projection.owned.agents.add(preset.name);
      agents++;
    }

    for (const entry of features.mcps?.getAll() ?? []) {
      if (!allowedMcp.has(entry.name)) continue;
      const { pluginName: _p, ...mcp } = entry;
      resourceHub.addMcp(mcp as McpServerEntry, undefined, entry.pluginName ?? 'feature');
      projection.owned.mcps.add(entry.name);
      mcps++;
    }

    return {
      tools,
      skills,
      agents,
      mcps,
      cacheHit: false,
      release: () => this.#releaseTurn(resourceHub, projection),
    };
  }

  #releaseTurn(resourceHub: AgentResourceHub, projection: Projection): void {
    if (!projection.retired) {
      // Live projection: keep the cache even when no turn is in flight.
      projection.inFlight = Math.max(0, projection.inFlight - 1);
      return;
    }
    if (!this.retired.has(projection)) return; // already purged (double release)
    projection.inFlight--;
    if (projection.inFlight > 0) return;
    this.retired.delete(projection);
    // Skip names the live projection (or another still-active retired
    // projection) re-registered under the same name.
    const retained = emptyOwned();
    if (this.live) mergeOwned(retained, this.live.owned);
    for (const other of this.retired) {
      if (other.inFlight > 0) mergeOwned(retained, other.owned);
    }
    purgeOwned(resourceHub, projection.owned, retained);
  }
}

export function createFeatureCapabilityIngress(): FeatureCapabilityIngress {
  return new FeatureCapabilityIngress();
}
