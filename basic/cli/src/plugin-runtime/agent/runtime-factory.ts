import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  AIService,
  AgentEventBus,
  AgentResourceHub,
  discoverWorkspaceAgents,
  publishOutboundElements,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type ProactiveOutboundService,
  type TurnEvent,
  type TurnRequest,
} from '@zhin.js/agent';
import {
  ZhinAgent,
  composeZhinAgentRuntime,
  createNativeAgentToolSuite,
  type KnowledgeIndex,
  type AgentTraceRecorder,
} from '@zhin.js/agent/runtime';
import type { AgentTool, JsonSchema } from '@zhin.js/ai';

const logger = getLogger('agent');

export function observeAgentTurnTrace(
  trace: AgentTraceRecorder,
  request: TurnRequest,
  downstream?: (event: TurnEvent) => void,
): (event: TurnEvent) => void {
  return (event) => {
    const tracedEvent: TurnEvent = event.type === 'turn_start'
      && request.origin.kind === 'im'
      && request.origin.messageId
      ? { ...event, sourceMessageId: request.origin.messageId }
      : event;
    trace.record(request.session.key, request.identity.turnId, tracedEvent);
    downstream?.(event);
  };
}

export function createRuntimeZhinAgent(
  service: AIService,
  im: ImRuntime,
  projectRoot: string,
  approvalPort?: ApprovalPort,
  audioTranscriber?: AudioTranscriptionPort,
  knowledgeIndex?: KnowledgeIndex,
): {
  agent: ZhinAgent;
  events: AgentEventBus;
  runtime: ReturnType<typeof composeZhinAgentRuntime>;
  seedPresets: () => Promise<number>;
} {
  const binding = service.getBindingRegistry().requireZhinBinding();
  const provider = service.getProvider(binding.providerAlias);
  const events = new AgentEventBus();
  const agent = new ZhinAgent(provider, {
    ...(service.getAgentConfig() ?? {}),
    chatModel: binding.model,
  }, events, service.getLlmRuntime());
  const composed = composeZhinAgentRuntime(agent, provider, createRuntimeProactiveOutbound(im));
  composed.host.approvalPort = approvalPort;
  const resourceHub = new AgentResourceHub();
  agent.configure({
    agentCore: composed.agentCore,
    toolSystem: composed.toolSystem,
    contextSystem: composed.contextSystem,
    memorySystem: composed.memorySystem,
    sessionSystem: composed.sessionSystem,
    eventSystem: composed.eventSystem,
    resourceHub,
    providerResolver: (alias) => service.getProvider(alias),
    llmRuntime: service.getLlmRuntime(),
    audioTranscriber,
    activeBinding: binding,
    deferredResultSender: composed.deliverOutbound,
    subagentSender: composed.deliverOutbound,
  });

  agent.initSubagentSystem(() => buildRuntimeSubagentAgentTools(service, knowledgeIndex));
  agent.getSubagentSystem()?.configureRouting({
    getProvider: (alias) => service.getProvider(alias),
    resolveBinding: (name) => service.getBindingRegistry().getBinding(name),
    getMcpRegistry: () => null,
    resolveAgentMeta: async (name) => {
      const metas = await discoverWorkspaceAgents(projectRoot);
      return metas.find((meta) => meta.name === name) ?? null;
    },
    getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
  });

  // Persistence readiness is latched after DatabaseHost activateNext (or
  // immediately when sessions.useDatabase === false / no DatabaseHost).
  return {
    agent,
    events,
    runtime: composed,
    seedPresets: () => seedResourceHubAgentPresets(resourceHub, projectRoot),
  };
}

/**
 * Subagent tool pool — derived from the same generation projection as the
 * main turn so the ToolIndex is the single source of truth. Native builtin
 * tools are projected from the same native ToolFeature definitions used by the main turn.
 */
function buildRuntimeSubagentAgentTools(
  service: AIService,
  knowledgeIndex?: KnowledgeIndex,
): AgentTool[] {
  const nativeTools = createNativeAgentToolSuite({
    resolveProvider: (alias) => service.getProvider(alias),
    resolveImageDefaults: (alias) => service.getImageGenerationDefaults(alias),
    knowledgeIndex,
  });
  return nativeTools.map((native): AgentTool => ({
    name: native.name,
    description: native.definition.description,
    parameters: native.definition.inputSchema as JsonSchema,
    source: 'builtin',
    execute: (args: Record<string, unknown>, _ctx?: unknown, execCtx?: unknown) =>
      (native.definition.execute as (input: unknown, context: unknown) => Promise<unknown>)(
        args,
        execCtx,
      ),
  }));
}

async function seedResourceHubAgentPresets(
  resourceHub: AgentResourceHub,
  projectRoot: string,
): Promise<number> {
  try {
    const metas = await discoverWorkspaceAgents(projectRoot);
    for (const meta of metas) {
      if (resourceHub.subagents.getPreset(meta.name)) continue;
      resourceHub.addAgentPreset({
        name: meta.name,
        description: meta.description,
        systemPrompt: meta.systemPrompt,
        tools: meta.toolNames,
        model: meta.model,
        filePath: meta.filePath,
      });
    }
    if (metas.length > 0) {
      logger.info(formatCompact({
        op: 'agent_host_presets',
        count: metas.length,
        names: metas.map((meta) => meta.name).join(','),
      }));
    }
    return metas.length;
  } catch (error) {
    logger.warn(formatCompact({
      op: 'agent_host_presets_fail',
      error: error instanceof Error ? error.message : String(error),
    }));
    return 0;
  }
}

export function createRuntimeProactiveOutbound(im: ImRuntime): ProactiveOutboundService {
  return {
    async send(ctx, content) {
      const result = await im.endpoints.send({
        adapter: ctx.scene.platform,
        endpointKey: ctx.scene.endpointKey,
        conversation: {
          kind: ctx.scene.kind as 'private' | 'group' | 'channel',
          id: ctx.scene.sceneId,
        },
        content,
      });
      return result.messageId || 'ok';
    },
    async sendElements(ctx, elements) {
      const content = await publishOutboundElements(elements, ctx.scene.platform);
      if (content.length === 0) return [];
      const id = await this.send(ctx, content);
      return [id];
    },
  };
}
