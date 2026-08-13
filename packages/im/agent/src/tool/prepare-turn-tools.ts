import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import {
  ensureMcpConnectionsForBinding,
  getMcpToolsForBinding,
} from '../orchestrator/mcp-lifecycle.js';
import { rehydrateTurnActiveSkills } from '../assistant/schedule-skills.js';
import { captureDeferredSnapshotBefore, cloneDeferredSnapshot, setTurnActiveSkills } from '../internal/turn-context.js';
import { attachWebSearchLocale } from './web-search-locale-attach.js';
import type { ZhinAgentPrivate, Tool } from '../internal/agent-host.js';
import { defaultToolSystem } from '../tool/tool-system.js';
import { applyDynamicTurnOverrides } from '../dynamic/dynamic-registry.js';
import type { ResolvedToolsForTurn } from './deferred-resolution.js';
import { resolveScheduleTools } from '../schedule-domain/tool-resolver.js';
import { secureScheduleTools } from '../schedule-domain/security-harness.js';
import { loadScheduleSkillContext } from '../schedule-domain/prompt-assembler.js';
import { getLogger } from '@zhin.js/logger';
import type { HostScheduleTurnContext } from '../internal/host-types.js';

const scheduleLogger = getLogger('schedule-execution-domain');

function listSpawnableAgentNames(host: ZhinAgentPrivate): string[] {
  const presets = host.orchestrator?.subagents.getAllPresets().map((p) => p.name) ?? [];
  return [...new Set(presets.filter(Boolean))].sort();
}

export interface TurnToolsPrep {
  contextForTools: Message;
  allTools: AgentTool[];
  resolved: ResolvedToolsForTurn;
  resolvedTools: AgentTool[];
  deferredStats?: string;
  catalog: ResolvedToolsForTurn['catalog'];
  sessionSnapshot: ResolvedToolsForTurn['sessionSnapshot'];
}

export async function prepareTurnTools(
  host: ZhinAgentPrivate,
  opts: {
    content: string;
    commMessage: Message;
    externalTools: Tool[];
    sessionId: string;
    userId: string;
    mcpServerNames: string[];
    scheduleContext?: HostScheduleTurnContext;
  },
): Promise<TurnToolsPrep> {
  const userId = opts.userId;
  host.turnDynamicInstructions = undefined;
  const contextForTools = await attachWebSearchLocale(opts.commMessage, userId, host.userProfiles);

  if (host.orchestrator && opts.mcpServerNames.length > 0) {
    await ensureMcpConnectionsForBinding(host.orchestrator.mcps, opts.mcpServerNames, (event) => {
      const payload = host.emitter.createPayload(opts.sessionId, contextForTools, 'text', {
        path: 'agent',
        serverName: event.serverName,
        loadedToolNames: event.toolNames,
        reason: event.connected === false ? 'disconnected' : undefined,
        error: event.error,
      });
      if (event.phase === 'start') {
        host.emitter.emit('ai.mcp.connect.start', payload);
      } else if (event.phase === 'finish') {
        host.emitter.emit('ai.mcp.connect.finish', payload);
      } else {
        host.emitter.emit('ai.mcp.connect.error', payload);
      }
    });
  }

  const mcpTools = host.orchestrator && opts.mcpServerNames.length > 0
    ? getMcpToolsForBinding(host.orchestrator.mcps, opts.mcpServerNames)
    : [];

  const toolSystem = host.toolSystem ?? defaultToolSystem;
  let allTools = await toolSystem.collectForTurn({
    host,
    message: contextForTools,
    content: opts.content,
    sessionId: opts.sessionId,
    userId,
    config: host.config,
    skillRegistry: host.skillRegistry,
    externalTools: opts.externalTools,
    externalRegistered: host.externalTools,
    imTranscriptStore: host.imTranscriptStore,
    userProfiles: host.userProfiles,
    mcpTools,
    spawnableAgentNames: host.subagentSystem ? listSpawnableAgentNames(host) : undefined,
  });

  const dynamicApplied = await applyDynamicTurnOverrides({
    tools: allTools,
    ctx: {
      sessionId: opts.sessionId,
      userId,
      adapter: String(contextForTools.$adapter),
      commMessage: contextForTools,
      agentId: host.activeBinding?.name,
    },
  });
  allTools = dynamicApplied.tools;
  host.turnDynamicInstructions = dynamicApplied.additionalInstructions;

  const scheduleContext = opts.scheduleContext;
  if (scheduleContext) {
    const resolution = resolveScheduleTools({
      prompt: opts.content,
      executionPlan: scheduleContext.executionPlan,
      tools: allTools,
      skillRegistry: host.skillRegistry,
    });
    const resolvedTools = secureScheduleTools({
      tools: resolution.tools,
      message: contextForTools,
      config: host.config,
      context: scheduleContext.security,
      onDenial: denial => scheduleContext.securityDenials.push(denial),
    });
    const catalog: ResolvedToolsForTurn['catalog'] = [];
    const sessionSnapshot: ResolvedToolsForTurn['sessionSnapshot'] = {
      loadedTools: {},
      loadedSkills: [],
    };
    scheduleContext.toolResolution = {
      tools: resolvedTools.map(tool => tool.name),
      skills: resolution.skills,
      resolvedBy: resolution.resolvedBy,
      missingTools: resolution.missingTools,
      missingSkills: resolution.missingSkills,
    };
    for (const name of resolution.missingTools) {
      scheduleLogger.warn(`Schedule execution plan tool not found: ${name}`);
    }
    for (const name of resolution.missingSkills) {
      scheduleLogger.warn(`Schedule execution plan skill not found: ${name}`);
    }
    setTurnActiveSkills(await loadScheduleSkillContext(host, resolution.skills));
    const resolved: ResolvedToolsForTurn = {
      tools: resolvedTools,
      catalog,
      deferred: false,
      sessionSnapshot,
    };
    return {
      contextForTools,
      allTools,
      resolved,
      resolvedTools,
      catalog,
      sessionSnapshot,
    };
  }

  const resolved = await toolSystem.resolveForTurn(
    host,
    allTools,
    opts.sessionId,
    String(contextForTools.$adapter),
  );
  const { tools: resolvedTools, deferredStats, catalog, sessionSnapshot: initialSnapshot } = resolved;

  const sessionSnapshot = initialSnapshot;
  captureDeferredSnapshotBefore(sessionSnapshot);
  host.deferred.lastSnapshotBefore = cloneDeferredSnapshot(sessionSnapshot);
  await rehydrateTurnActiveSkills(host, opts.sessionId, host.getAlwaysSkillsBaseline());
  host.deferred.lastSessionSnapshot = sessionSnapshot;
  host.deferred.lastCatalog = catalog;
  host.deferred.lastToolSearchStats = deferredStats;

  return {
    contextForTools,
    allTools,
    resolved,
    resolvedTools,
    deferredStats,
    catalog,
    sessionSnapshot,
  };
}
