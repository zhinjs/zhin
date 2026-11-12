import { randomUUID } from 'node:crypto';
import { getLogger } from '@zhin.js/logger';
import { untrustedContent, type ImRuntime } from '@zhin.js/core/runtime';
import {
  AIService,
  AgentEventBus,
  AgentResourceHub,
  publishOutboundElements,
  resolveOutboundCapabilities,
  modelMediaTrust,
  NO_MEDIA_AUTHORITY,
  type AiControlPlane,
  type ApprovalPort,
  type AudioTranscriptionPort,
  type DecisionEventLog,
  type ProactiveOutboundService,
  type ProactiveSendContext,
  type ImageAssetPublisher,
  type LocalImageAssetStore,
} from '../../index.js';
import {
  ZhinAgent,
  composeZhinAgentRuntime,
} from '../index.js';
import { auditControlOutbound, checkControlAtOutbound, logControlBlocked } from '../ingress/control-gate.js';
import { auditOutbound, createDecisionAudit, decisionScopeOf } from '../ingress/decision-audit.js';

const logger = getLogger('agent');

export interface RuntimeZhinAgentOptions {
  readonly service: AIService;
  readonly im: ImRuntime;
  readonly approvalPort?: ApprovalPort;
  readonly audioTranscriber?: AudioTranscriptionPort;
  readonly localAssets?: LocalImageAssetStore;
}

export function createRuntimeZhinAgent(options: RuntimeZhinAgentOptions): {
  agent: ZhinAgent;
  events: AgentEventBus;
  runtime: ReturnType<typeof composeZhinAgentRuntime>;
} {
  const { service, approvalPort, audioTranscriber, localAssets } = options;
  const binding = service.getBindingRegistry().requireZhinBinding();
  const events = new AgentEventBus();
  const agent = new ZhinAgent({ config: {
    ...(service.getAgentConfig() ?? {}), contextHistory: service.getContextHistoryConfig(),
  }, events });
  const composed = composeZhinAgentRuntime({ agent });
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
    audioTranscriber,
    imageAssets: service.imageAssets,
    localAssets,
    activeBinding: binding,
  });

  // Persistence readiness is latched by the Agent persistence coordinator
  // (database mode: after DatabaseHost activateNext; file mode: in installAgentPersistence).
  return {
    agent,
    events,
    runtime: composed,
  };
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
  const mediaCapabilities = (scene: ProactiveSendContext['scene']) => resolveOutboundCapabilities(scene.platform, {
    capabilities: im.endpoints.capabilities({ adapter: scene.platform, endpointKey: scene.endpointKey }),
    kind: scene.kind as 'private' | 'group' | 'channel',
  });
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
      if (ctx.onReceipt && result.receipt) {
        try {
          const observation = ctx.onReceipt(result.receipt);
          if (observation) void observation.catch(() => logger.warn('Proactive delivery receipt observation failed'));
        }
        catch { logger.warn('Proactive delivery receipt observation failed'); }
      }
      return result.messageId || 'ok';
    },
    mediaCapabilities,
    async sendElements(ctx, elements) {
      guard(ctx);
      // Proactive sends carry no Turn policy: only inline media, no model-referenced paths or URLs.
      const authority = { ...NO_MEDIA_AUTHORITY, imageAssets };
      const caps = mediaCapabilities(ctx.scene);
      const content = await publishOutboundElements(elements, ctx.scene.platform, caps, authority);
      if (content.length === 0) return [];
      // Model-authored output: Core admits only remote / inline media and platform tokens (no host files).
      const id = await this.send(ctx, untrustedContent(content, modelMediaTrust(`agent:proactive:${ctx.source}`, authority, { locale: ctx.locale, maxInlineBytes: caps.maxAttachmentBytes })));
      return [id];
    },
  };
}
