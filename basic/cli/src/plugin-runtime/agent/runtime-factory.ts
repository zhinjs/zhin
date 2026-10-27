import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { ImRuntime } from '@zhin.js/core/runtime';
import {
  AIService,
  AgentEventBus,
  AgentResourceHub,
  createLlmMediaPerceptionPort,
  discoverWorkspaceAgents,
  publishOutboundElements,
  NO_MEDIA_AUTHORITY,
  type AiControlPlane,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type DecisionEventLog,
  type ProactiveOutboundService,
  type ProactiveSendContext,
  type TurnEvent,
  type TurnRequest,
  type ImageAssetPublisher,
  type LocalImageAssetStore,
} from '@zhin.js/agent';
import {
  ZhinAgent,
  composeZhinAgentRuntime,
  createNativeAgentToolSuite,
  getAgentTurnDecisionRuntime,
  type KnowledgeIndex,
  type AgentTraceRecorder,
} from '@zhin.js/agent/runtime';
import type { AgentTool, JsonSchema } from '@zhin.js/ai';
import { auditControlOutbound, checkControlAtOutbound, logControlBlocked } from './turn/control-gate.js';
import { auditOutbound, createDecisionAudit, decisionScopeOf } from './turn/decision-audit.js';

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
  localAssets?: LocalImageAssetStore,
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
  const composed = composeZhinAgentRuntime(agent, provider, createRuntimeProactiveOutbound(
    im,
    () => agent.getControlPlane(),
    () => agent.getDecisionEvents(),
    service.imageAssets,
  ));
  const mediaPerception = createRuntimeMediaPerception(service);
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
    imageAssets: service.imageAssets,
    localAssets,
    ...(mediaPerception ? { mediaPerception } : {}),
    activeBinding: binding,
    deferredResultSender: composed.deliverOutbound,
    subagentSender: composed.deliverOutbound,
  });

  agent.initSubagentSystem(() => buildRuntimeSubagentAgentTools(service, knowledgeIndex));
  agent.getSubagentSystem()?.configureRouting({
    imageAssets: service.imageAssets,
    localAssets,
    mediaPerception,
    getProvider: (alias) => service.getProvider(alias),
    resolveBinding: (name) => service.getBindingRegistry().getBinding(name),
    getMcpRegistry: () => null,
    resolveAgentMeta: async (name) => {
      const metas = await discoverWorkspaceAgents(projectRoot);
      return metas.find((meta) => meta.name === name) ?? null;
    },
    getParentContextSnapshot: (origin) => agent.buildParentContextSnapshotForSubagent(origin),
  });

  // Persistence readiness is latched by the Workroom persistence coordinator
  // (database mode: after DatabaseHost activateNext; file mode: in prepare), or
  // by installAgentHost right after composition when Workroom is not installed.
  return {
    agent,
    events,
    runtime: composed,
    seedPresets: () => seedResourceHubAgentPresets(resourceHub, projectRoot),
  };
}

/**
 * `ai.multimodal.perception` → perception port on the service-owned LLM runtime
 * (same transport and resilience layer as turns). Unset → undefined (no pre-pass).
 */
function createRuntimeMediaPerception(service: AIService) {
  const config = service.getPerceptionConfig();
  if (!config) return undefined;
  logger.info(formatCompact({
    op: 'media_perception_enabled',
    provider: config.provider,
    model: config.model,
    kinds: config.kinds.join(','),
  }));
  return createLlmMediaPerceptionPort({
    runtime: service.getLlmRuntime(),
    config,
    resilience: service.getAgentConfig()?.providerResilience,
    onEvent: (event) => {
      const { type, ...fields } = event;
      logger.warn(formatCompact({ op: `media_perception_${type}`, ...fields }));
    },
  });
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
    imageAssets: service.imageAssets,
    knowledgeIndex,
    resolveDecision: getAgentTurnDecisionRuntime,
  });
  // Public file upload requires the canonical Turn approval and file-authority gateway.
  // The legacy standalone pool cannot supply those capabilities.
  return nativeTools.filter(native => native.name !== 'upload_image').map((native): AgentTool => ({
    name: native.name,
    description: native.definition.description,
    parameters: native.definition.inputSchema as JsonSchema,
    source: 'builtin',
    requiresApproval: native.definition.requiresApproval,
    risk: native.definition.risk,
    riskCategory: native.definition.riskCategory,
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

/** 主动出站被控制面拦下（ADR 0036 切片 D）：不发送，调用方按发送失败处理。 */
export class ControlBlockedOutboundError extends Error {
  constructor(readonly reasonCode: string) {
    super(`proactive outbound blocked by control plane: ${reasonCode}`);
    this.name = 'ControlBlockedOutboundError';
  }
}

/**
 * Agent 主动出站（定时任务通知、子代理续写、ask_user 等）。控制面止损类开关
 * （`emergency_stop` / `muted` / `read_only`）命中时不发，写 `control_gate` + `outbound`（抑制），并抛
 * {@link ControlBlockedOutboundError}（fail closed）。
 */
export function createRuntimeProactiveOutbound(
  im: ImRuntime,
  controlPlane?: () => AiControlPlane | undefined,
  decisionEvents?: () => DecisionEventLog | undefined,
  imageAssets?: ImageAssetPublisher,
): ProactiveOutboundService {
  const guard = (ctx: ProactiveSendContext): void => {
    const scope = ctx.scene.kind === 'group' || ctx.scene.kind === 'channel' ? ctx.scene.kind : 'private';
    const target = { platform: ctx.scene.platform, scope, sceneId: ctx.scene.sceneId } as const;
    const verdict = checkControlAtOutbound(controlPlane?.(), target);
    if (!verdict.blocked) return;
    logControlBlocked('agent_proactive_blocked_control', `${ctx.scene.platform}:${ctx.scene.sceneId}`, verdict);
    const audit = createDecisionAudit(decisionEvents?.(), decisionScopeOf({
      turnId: randomUUID(), platform: ctx.scene.platform, scope, sceneId: ctx.scene.sceneId, endpoint: ctx.scene.endpointKey,
    }));
    auditControlOutbound(audit, verdict, { source: `proactive:${ctx.source}` });
    auditOutbound(audit, { status: 'suppressed' }, { source: `proactive:${ctx.source}`, control: true });
    throw new ControlBlockedOutboundError(verdict.reasonCode);
  };
  return {
    async send(ctx, content) {
      guard(ctx);
      const result = await im.endpoints.send({
        adapter: ctx.scene.platform,
        endpointKey: ctx.scene.endpointKey,
        conversation: {
          kind: ctx.scene.kind as 'private' | 'group' | 'channel',
          id: ctx.scene.sceneId,
        },
        content,
        locale: ctx.locale,
      });
      return result.messageId || 'ok';
    },
    async sendElements(ctx, elements) {
      guard(ctx);
      // Proactive sends carry no Turn policy: only inline media, no model-referenced paths or URLs.
      const content = await publishOutboundElements(elements, ctx.scene.platform, undefined, { ...NO_MEDIA_AUTHORITY, imageAssets });
      if (content.length === 0) return [];
      const id = await this.send(ctx, content);
      return [id];
    },
  };
}
