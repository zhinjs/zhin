/**
 * Bootstrap per-endpoint ZhinAgent runtimes for multi-bot collaboration cells.
 */

import type { Plugin } from '@zhin.js/core';
import { ZhinAgent } from '../zhin-agent/index.js';
import type { AIService } from '../service.js';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { getAgentRuntimeRegistry } from './runtime-registry.js';
import { getCollaborationCellService } from './cell-service.js';
import { findCellMemberByEndpoint } from './collaboration-config.js';
import { resolvePipelineRoleBinding } from '../config/resolve-pipeline-binding.js';
import { isPipelineRole, type CollaborationCell } from './types.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT } from '../zhin-agent/context-tail-limit.js';

export interface BootstrapRuntimesOptions {
  refs: AIServiceRefs;
  plugin: Plugin;
  ai: AIService;
  primaryAgent: ZhinAgent;
  agentConfig?: ZhinAgentConfig;
}

let lastBootstrapOptions: BootstrapRuntimesOptions | null = null;

function resolveMemberForEndpoint(
  cells: CollaborationCell[],
  endpointId: string,
): { primary: string; pipelineRole?: string } {
  for (const cell of cells) {
    const member = findCellMemberByEndpoint(cell, endpointId);
    if (member) return { primary: member.primary, pipelineRole: member.pipelineRole };
  }
  return { primary: DEFAULT_ZHIN_AGENT_NAME };
}

/** 解析 Endpoint 绑定：优先 pipelineRole（继承 zhin），否则按 primary 名 / zhin 回退。 */
function resolveEndpointBinding(
  ai: AIService,
  member: { primary: string; pipelineRole?: string },
): ResolvedAgentBinding {
  if (isPipelineRole(member.pipelineRole)) {
    const routing = ai.getRoutingConfig();
    return resolvePipelineRoleBinding(member.pipelineRole, {
      agents: routing.agents,
      pipeline: routing.pipeline,
    });
  }
  return (
    ai.getBindingRegistry().getBinding(member.primary)
    ?? ai.getBindingRegistry().requireZhinBinding()
  );
}

function applyEndpointRuntimes(options: BootstrapRuntimesOptions): void {
  const { refs, plugin, ai, primaryAgent, agentConfig } = options;
  const registry = getAgentRuntimeRegistry();
  registry.registerDefault(primaryAgent);
  refs.zhinAgent = primaryAgent;

  const cellList = getCollaborationCellService().listCells();
  if (cellList.length === 0) return;

  const endpointIds = [...new Set(cellList.flatMap((c) => c.members.map((m) => m.endpointId)))].sort();
  if (endpointIds.length === 1) {
    const endpointId = endpointIds[0]!;
    const member = resolveMemberForEndpoint(cellList, endpointId);
    const binding = resolveEndpointBinding(ai, member);
    primaryAgent.configure({ activeBinding: binding });
    registry.registerForEndpoint(endpointId, primaryAgent);
    return;
  }

  const orchestrator = plugin.root.inject('agent');
  const modelRegistry = ai.getModelRegistry();
  const primaryEndpointId = endpointIds[0]!;

  const collabTail = agentConfig?.contextTailMessageLimit ?? COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT;
  const runtimeConfig = {
    ...(agentConfig ?? {}),
    contextTailMessageLimit: collabTail,
  };

  for (const endpointId of endpointIds) {
    const member = resolveMemberForEndpoint(cellList, endpointId);
    const binding = resolveEndpointBinding(ai, member);

    if (endpointId === primaryEndpointId) {
      primaryAgent.configure({ activeBinding: binding });
      registry.registerForEndpoint(endpointId, primaryAgent);
      continue;
    }
    const provider = ai.getProvider(binding.providerAlias);

    const runtime = new ZhinAgent(provider, {
      ...runtimeConfig,
      chatModel: binding.model,
    });
    runtime.configure({
      hostPlugin: plugin.root,
      providerResolver: (alias) => ai.getProvider(alias),
      activeBinding: binding,
      modelRegistry: modelRegistry ?? undefined,
      skillRegistry: orchestrator?.skills,
      orchestrator: orchestrator ?? undefined,
    });
    registry.registerForEndpoint(endpointId, runtime);
    primaryAgent.sharePersistenceWith(runtime);
  }
}

/** DB 就绪后，将持久化层同步到协作 Cell 内各 Endpoint Runtime */
export function syncCollaborationRuntimePersistence(primary: ZhinAgent): void {
  const registry = getAgentRuntimeRegistry();
  for (const endpointId of registry.listEndpointIds()) {
    const runtime = registry.getForEndpoint(endpointId);
    if (runtime && runtime !== primary) {
      primary.sharePersistenceWith(runtime);
    }
  }
}

export function markAllRuntimesPersistenceReady(primary: ZhinAgent): void {
  primary.markMemoryPersistenceReady();
  syncCollaborationRuntimePersistence(primary);
}

export function bootstrapEndpointRuntimes(options: BootstrapRuntimesOptions): void {
  lastBootstrapOptions = options;
  applyEndpointRuntimes(options);
}

/** DB 加载协作单元后重新绑定 Endpoint Runtime */
export async function rebootstrapEndpointRuntimes(): Promise<void> {
  if (!lastBootstrapOptions) return;
  applyEndpointRuntimes(lastBootstrapOptions);
}
