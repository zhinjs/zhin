/**
 * Register discovered plugin agent/ surfaces into AgentOrchestrator and schedules.
 */

import { Logger, type Plugin, type Tool as CoreTool } from '@zhin.js/core';
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

const logger = new Logger(null, 'agent-surface-register');

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
  toolService?: { addTool: (tool: CoreTool, pluginName: string) => () => void } | null;
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

  const surfaces = await discoverAllPluginAgentSurfaces(root);
  const allBridgedTools: OrchestratorTool[] = [];

  for (const surface of surfaces) {
    for (const flat of flattenSurfaces(surface)) {
      for (const discovered of flat.tools) {
        if (registeredAuthoringToolNames.has(discovered.runtimeName)) continue;
        try {
          const bridged = bridgeAuthoringTool(discovered);
          const tool = bridgeAuthoringToolToOrchestratorTool(bridged);
          orchestrator.addTool(tool, undefined, discovered.pluginName);
          options.toolService?.addTool(tool as CoreTool, discovered.pluginName);
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
        orchestrator.addMcp(bridged.entry, undefined, discovered.pluginName);
        connectionCount++;
      }

      for (const discovered of flat.hooks) {
        const hook = bridgeAuthoringHook(discovered);
        orchestrator.addHook(hook, undefined, discovered.pluginName);
        hookCount++;
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
          orchestrator.addSkill(skill, undefined, discovered.pluginName);
          registeredAuthoringSkillNames.add(discovered.runtimeName);
          skillCount++;
        } catch (e) {
          logger.warn(`Failed to register skill ${discovered.runtimeName}: ${errMsg(e)}`);
        }
      }
    }
  }

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
