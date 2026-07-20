/**
 * Register discovered plugin agent/ surfaces into Capability Features (ADR 0042).
 * Orchestrator loading is deferred to Capability Ingress (ensureCore / ensureForTurn).
 */

import { type Plugin, type Tool as CoreTool, type Skill as CoreSkill, type ToolFeature, type SkillFeature, getLogger } from '@zhin.js/core';
import { ScheduleEngine, getScheduleEngine, setScheduleEngine } from '@zhin.js/kernel';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { Tool as OrchestratorTool } from '../orchestrator/types.js';
import {
  bridgeAuthoringConnection,
  bridgeAuthoringHook,
  bridgeAuthoringSkill,
  bridgeAuthoringTool,
  bridgeAuthoringToolToOrchestratorTool,
} from '../authoring/bridge.js';
import type { DiscoveredPluginAgentSurface } from '../authoring/types.js';
import {
  discoverAllPluginAgentSurfaces,
} from './agent-surface.js';
import { errMsg } from './utils.js';
import { registerAuthoringStateFromDefinition } from '../state/agent-state-store.js';
import { registerDynamicResolver } from '../dynamic/dynamic-registry.js';
import type { MCPFeature } from '../features/mcp-feature.js';

const logger = getLogger('agent-surface-register');

const registeredScheduleIds = new Set<string>();
const registeredAuthoringToolNames = new Set<string>();
const registeredAuthoringSkillNames = new Set<string>();

function ensureScheduleEngine(): ScheduleEngine {
  let engine = getScheduleEngine();
  if (!engine) {
    engine = new ScheduleEngine();
    setScheduleEngine(engine);
  }
  return engine;
}

export interface RegisterAgentSurfaceOptions {
  connectionsConfig?: Record<string, unknown>;
  /** @deprecated Prefer root.inject('tool'); kept for call-site compatibility */
  toolService?: { addTool: (tool: CoreTool, pluginName: string) => () => void } | null;
  toolFeature?: ToolFeature | null;
  skillFeature?: SkillFeature | null;
  mcpFeature?: MCPFeature | null;
}

function flattenSurfaces(surface: DiscoveredPluginAgentSurface): DiscoveredPluginAgentSurface[] {
  return [surface, ...surface.subagents.flatMap((s) => flattenSurfaces(s))];
}

export async function registerPluginAgentSurfaces(
  orchestrator: AgentOrchestrator,
  root: Plugin,
  options: RegisterAgentSurfaceOptions = {},
): Promise<{
  tools: number;
  skills: number;
  schedules: number;
  connections: number;
  hooks: number;
  evals: number;
  workspaceAgents: number;
}> {
  let toolCount = 0;
  let skillCount = 0;
  let scheduleCount = 0;
  let connectionCount = 0;
  let hookCount = 0;
  let evalCount = 0;

  const toolFeature = options.toolFeature
    ?? root.inject('tool')
    ?? (options.toolService as ToolFeature | null | undefined)
    ?? null;
  const skillFeature = options.skillFeature ?? root.inject('skill') ?? null;
  const mcpFeature = options.mcpFeature ?? root.inject('mcpFeature') ?? null;

  const surfaces = await discoverAllPluginAgentSurfaces(root);
  const allBridgedTools: OrchestratorTool[] = [];

  for (const surface of surfaces) {
    for (const flat of flattenSurfaces(surface)) {
      for (const discovered of flat.tools) {
        if (registeredAuthoringToolNames.has(discovered.runtimeName)) continue;
        try {
          const bridged = bridgeAuthoringTool(discovered);
          const tool = bridgeAuthoringToolToOrchestratorTool(bridged);
          // Feature-only write (Ingress loads Orchestrator on demand)
          if (toolFeature) {
            toolFeature.addTool(tool as CoreTool, discovered.pluginName);
          }
          allBridgedTools.push(tool);
          registeredAuthoringToolNames.add(discovered.runtimeName);
          toolCount++;
        } catch (e) {
          logger.warn(`Failed to register tool ${discovered.runtimeName}: ${errMsg(e)}`);
        }
      }

      for (const discovered of flat.schedules) {
        const scheduleId = discovered.runtimeName;
        if (registeredScheduleIds.has(scheduleId)) continue;
        try {
          const engine = ensureScheduleEngine();
          engine.register(
            scheduleId,
            'solar',
            async () => { await discovered.definition.execute(); },
            { cron: discovered.definition.cron },
          );
          registeredScheduleIds.add(scheduleId);
          scheduleCount++;
        } catch (e) {
          logger.warn(`Failed to register schedule ${scheduleId}: ${errMsg(e)}`);
        }
      }

      for (const discovered of flat.connections) {
        const configValue = options.connectionsConfig?.[discovered.slotName]
          ?? options.connectionsConfig?.[discovered.runtimeName];
        if (configValue === undefined) {
          logger.debug(`Connection ${discovered.slotName} has no config — skipped`);
          continue;
        }
        const bridged = bridgeAuthoringConnection(discovered, configValue);
        if (!bridged.ok) {
          logger.warn(bridged.error);
          continue;
        }
        if (mcpFeature) {
          mcpFeature.add(bridged.entry, discovered.pluginName);
        }
        connectionCount++;
      }

      for (const discovered of flat.hooks) {
        const hook = bridgeAuthoringHook(discovered);
        // Hooks remain on Orchestrator until a HookFeature exists
        orchestrator.addHook(hook, undefined, discovered.pluginName);
        hookCount++;
      }

      for (const discovered of flat.states) {
        registerAuthoringStateFromDefinition(
          discovered.runtimeName,
          discovered.pluginName,
          discovered.definition.initial,
        );
      }

      if (flat.dynamic) {
        registerDynamicResolver({
          pluginName: flat.dynamic.pluginName,
          resolve: flat.dynamic.definition.resolve,
        });
      }

      evalCount += flat.evals.length;
    }
  }

  // Skills after tools so toolNames can resolve
  for (const surface of surfaces) {
    for (const flat of flattenSurfaces(surface)) {
      for (const discovered of flat.skills) {
        if (registeredAuthoringSkillNames.has(discovered.runtimeName)) continue;
        try {
          const skill = bridgeAuthoringSkill(discovered, allBridgedTools);
          if (skillFeature) {
            skillFeature.add(skill as unknown as CoreSkill, discovered.pluginName);
          }
          registeredAuthoringSkillNames.add(discovered.runtimeName);
          skillCount++;
        } catch (e) {
          logger.warn(`Failed to register skill ${discovered.runtimeName}: ${errMsg(e)}`);
        }
      }
    }
  }

  root.inject('capabilityIngress')?.invalidate();

  return {
    tools: toolCount,
    skills: skillCount,
    schedules: scheduleCount,
    connections: connectionCount,
    hooks: hookCount,
    evals: evalCount,
    workspaceAgents: 0,
  };
}

export async function runPluginEvals(root: Plugin): Promise<{ id: string; ok: boolean; error?: string }[]> {
  const surfaces = await discoverAllPluginAgentSurfaces(root);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const surface of surfaces) {
    for (const ev of surface.evals) {
      try {
        let lastReply = '';
        const t = {
          send: async (_message: string) => { /* Phase 1: discovery + stub */ },
          get reply() { return lastReply; },
          succeeded: () => { lastReply = 'ok'; },
          calledTool: (_name: string) => ({ soft: () => {} }),
        };
        await ev.definition.test(t);
        results.push({ id: ev.runtimeName, ok: true });
      } catch (e) {
        results.push({ id: ev.runtimeName, ok: false, error: errMsg(e) });
      }
    }
  }
  return results;
}

export function resetAuthoringRegistrationForTests(): void {
  registeredScheduleIds.clear();
  registeredAuthoringToolNames.clear();
  registeredAuthoringSkillNames.clear();
}
