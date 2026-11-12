import { readOperationSession, untrustedContent } from '@zhin.js/core';
import type { HostMailbox } from '../../collaboration/host-mailbox.js';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  modelMediaTrust,
  publishOutboundElements,
  resolveOutboundCapabilities,
} from '../../index.js';
import { resolveToolHardGateImApproval } from '../../security/index.js';
import type { AgentRuntime } from '../index.js';
import { AnnouncementDispatcher } from './announcement-dispatch.js';
import { flattenOutputElements } from './content.js';
import { GroupFloodDetector } from './group-flood-detector.js';
import {
  GroupRuleEnforcer,
  GroupRuleImChannel,
  type GroupRuleEnforcementResult,
  type GroupRuleViolation,
} from './group-rule-enforcer.js';
import { reactionOf } from './ingress-delivery-helpers.js';
import { MemberLifecycle } from './member-lifecycle.js';
import {
  observeAgentTurnTrace,
  type AgentIngressFoundationPort,
} from './ports.js';
import { capabilityLocalName, deliveryOutcomeFromReceipt } from './request.js';
import { SceneEventIngress } from './scene-event-ingress.js';
import { SessionEventDispatcher } from './session-event-dispatch.js';
import { resolveTriggerTimeoutMs, sendOutputMessages } from './unified-mailbox-spine.js';

const logger = getLogger('agent');

/** 起草时没记 Bot 账号：只在该平台恰好一个在线账号时使用它（多账号时不猜）。 */
export function soleOnlineEndpoint(im: ImRuntime, platform: string): string | undefined {
  const online = im.endpoints.list()
    .filter((endpoint) => (endpoint.adapter === platform || endpoint.endpoint.adapter === platform) && endpoint.status === 'online');
  return online.length === 1 ? online[0]!.name : undefined;
}

export function createGroupRuleChannel(input: Readonly<{
  im: ImRuntime;
  agent: AgentIngressFoundationPort;
}>): GroupRuleImChannel {
  const { im, agent } = input;
  return new GroupRuleImChannel({
    // 构造时就订阅；测试桩可能不带 agent。
    rules: () => agent?.agent?.getGroupRules?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    imApproval: () => resolveToolHardGateImApproval(agent.agent.config?.toolHardGate?.imApproval),
    send: async (target, text) => {
      const endpointKey = target.endpoint ?? soleOnlineEndpoint(im, target.platform);
      if (!endpointKey) throw new Error('endpoint_unresolved');
      await im.endpoints.send({
        adapter: target.platform,
        endpointKey,
        conversation: { kind: 'group', id: target.groupId },
        content: text,
      });
    },
  });
}

export function createGroupRuleEnforcer(input: Readonly<{
  agent: AgentIngressFoundationPort;
  onSpoke: (key: string) => void;
}>): GroupRuleEnforcer {
  const { agent, onSpoke } = input;
  return new GroupRuleEnforcer({
    rules: () => agent?.agent?.getGroupRules?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    sessions: () => agent.agent.getUserProfiles?.()?.sessions,
    decisionEvents: () => agent.agent.getDecisionEvents?.(),
    hardGate: () => agent.agent.config?.toolHardGate,
    approvals: () => agent.agent.toolApprovals,
    opsCooldown: () => agent.agent.opsCooldown,
    onSpoke,
  });
}

export function executeGroupRule(input: Readonly<{
  im: ImRuntime;
  enforcer: GroupRuleEnforcer;
  violation: GroupRuleViolation;
  conversation: ConversationRef;
  source: Readonly<{ client: unknown; signal: AbortSignal }>;
}>): Promise<GroupRuleEnforcementResult> {
  const { im, enforcer, violation, conversation, source } = input;
  const operation = im.endpoints.captureOperation({
    target: conversation,
    client: source.client,
    signal: source.signal,
    requester: rootPluginId(),
  });
  const management = operation.management;
  return enforcer.enforce(violation, {
    signal: operation.signal,
    send: async (parts, signal) => deliveryOutcomeFromReceipt(await operation.send(
      parts.map(part => part.type === 'text'
        ? { type: 'text', data: { text: part.text } }
        : { type: 'mention', data: { target: part.id, ...(part.name ? { name: part.name } : {}) } }),
      { signal },
    )),
    ...(management?.inspectGroupMember
      ? {
          inspect: async signal =>
            management.inspectGroupMember!({ groupId: conversation.id, userId: violation.memberId, signal }),
        }
      : {}),
    mute: async (durationSec, signal) => {
      if (management?.moderateGroupMember) {
        await management.moderateGroupMember({
          groupId: conversation.id,
          userId: violation.memberId,
          action: { type: 'mute', durationSeconds: durationSec },
          signal,
        });
      } else if (management?.muteGroupMember) {
        await management.muteGroupMember({
          groupId: conversation.id,
          userId: violation.memberId,
          durationSeconds: durationSec,
          signal,
        });
      } else throw new Error('mute_unsupported');
    },
    kick: async signal => {
      signal.throwIfAborted();
      if (!management?.kickGroupMember) throw new Error('kick_unsupported');
      await management.kickGroupMember({ groupId: conversation.id, userId: violation.memberId, signal });
    },
    release: operation.release,
  });
}

/**
 * 复读刷屏（ADR 0039 §2 `flood`）：群里每条真人消息先记指纹；同一成员窗口内重复达阈值时交给规则执行器
 * （该群没有生效的 `flood` 规则时执行器什么都不做）。不阻塞本条消息的后续处理，失败只记日志。
 */
export function observeFloodMessage(input: Readonly<{
  im: ImRuntime;
  enforcer: GroupRuleEnforcer;
  floodDetector: GroupFloodDetector;
  message: Message;
  platform: string;
  endpoint: string | undefined;
}>): void {
  const { im, enforcer, floodDetector, message, platform, endpoint } = input;
  if (message.conversation.kind !== 'group') return;
  if (message.origin !== undefined && message.origin !== 'human') return;
  const memberId = message.sender?.id;
  if (!platform || !memberId) return;
  const at = Date.now();
  const verdict = floodDetector.observe({
    platform,
    groupId: message.conversation.id,
    memberId,
    content: message.content,
    ...(message.segments ? { segments: message.segments } : {}),
    at,
  });
  if (!verdict.hit) return;
  const session = readOperationSession(message);
  if (!session) return;
  void executeGroupRule({
    im,
    enforcer,
    conversation: message.conversation,
    source: { client: session.endpoint, signal: session.signal },
    violation: {
      platform,
      ...(endpoint ? { endpoint } : {}),
      groupId: message.conversation.id,
      memberId,
      ...(message.sender?.name ? { memberName: message.sender.name } : {}),
      ...(message.sender?.chatRole ? { memberChatRole: message.sender.chatRole } : {}),
      ...(message.sender?.platform ? { memberPlatform: message.sender.platform } : {}),
      trigger: 'flood',
      sentAt: at,
      ...(message.message?.id ? { messageId: message.message.id } : {}),
      evidence: verdict.samples,
      detection: { reasonCode: 'rule_hit_flood', payload: { count: verdict.count, windowMs: verdict.windowMs } },
    },
  }).then((result) => {
    if (result.kind !== 'no_rule') logger.info(formatCompact({ op: 'group_rule_flood', conv: `${platform}:${message.conversation.id}`, result: result.kind }));
  });
}

export function createSessionEventDispatcher(input: Readonly<{
  im: ImRuntime;
  agent: AgentIngressFoundationPort;
  onSpoke: (key: string) => void;
}>): SessionEventDispatcher {
  const { im, agent, onSpoke } = input;
  return new SessionEventDispatcher({
    events: () => agent.agent.getSessionEvents?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    sessions: () => agent.agent.getUserProfiles?.()?.sessions,
    decisionEvents: () => agent.agent.getDecisionEvents?.(),
    onSpoke,
    send: async (target, text) => {
      const endpointKey = target.endpoint ?? soleOnlineEndpoint(im, target.platform);
      if (!endpointKey) return { status: 'failed' as const, code: 'endpoint_unresolved', retryable: false };
      const result = await im.endpoints.send({
        adapter: target.platform,
        endpointKey,
        conversation: { kind: target.scope, id: target.id },
        content: text,
      });
      return { status: 'sent' as const, ...(result.messageId ? { messageId: result.messageId } : {}) };
    },
  });
}

export function createAnnouncementDispatcher(input: Readonly<{
  im: ImRuntime;
  agent: AgentIngressFoundationPort;
  onSpoke: (key: string) => void;
}>): AnnouncementDispatcher {
  const { im, agent, onSpoke } = input;
  return new AnnouncementDispatcher({
    announcements: () => agent.agent.getAnnouncements?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    sessions: () => agent.agent.getUserProfiles?.()?.sessions,
    decisionEvents: () => agent.agent.getDecisionEvents?.(),
    hardGate: () => agent.agent.config?.toolHardGate,
    approvals: () => agent.agent.toolApprovals,
    onSpoke,
    sendNotice: async (target, content) => {
      if (target.scope !== 'group') return { status: 'unsupported' as const, code: 'group_notice_requires_group' };
      const endpointKey = target.endpoint ?? soleOnlineEndpoint(im, target.platform);
      if (!endpointKey) return { status: 'failed' as const, code: 'endpoint_unresolved', retryable: false };
      const result = await im.endpoints.withManagement(target.platform, endpointKey, async (management) => {
        if (typeof management.sendGroupNotice !== 'function') return 'unsupported' as const;
        await management.sendGroupNotice({ groupId: target.id, content });
        return 'sent' as const;
      });
      if (result === 'sent') return { status: 'sent' as const };
      if (result === 'unsupported') return { status: 'unsupported' as const, code: 'group_notice_unsupported' };
      return { status: 'failed' as const, code: 'endpoint_unavailable', retryable: false };
    },
  });
}

export function createSceneEventIngress(input: Readonly<{
  projectRoot: string;
  im: ImRuntime;
  runtime: AgentRuntime;
  agent: AgentIngressFoundationPort;
  memberLifecycle: MemberLifecycle;
  onSpoke: (key: string) => void;
  /** ADR 0048 H3 (Q3): scene wakes run as event Mail turns of the route's host Mailbox. */
  mailbox?: () => HostMailbox | undefined;
}>): SceneEventIngress {
  const { projectRoot, im, runtime, agent, memberLifecycle, onSpoke, mailbox } = input;
  const readOnlyFilesystem = Object.freeze({ workspaceRoot: projectRoot, access: 'read-only' as const });
  // Scene-event turns have no single initiator: model-referenced files get the `user` decision.
  const moderationMediaAuthority = () => Object.freeze({
    filesystem: readOnlyFilesystem,
    imageAssets: agent.service.imageAssets,
    fileRole: 'user' as const,
  });
  return new SceneEventIngress({
    projectRoot,
    ...(mailbox ? { mailbox } : {}),
    triggerConfig: () => agent.service.getTriggerConfig(),
    reader: () => im.conversationEventReader,
    sessions: () => agent.agent.getUserProfiles?.()?.sessions,
    decisionEvents: () => agent.agent.getDecisionEvents?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    ownsWake: (signal) => memberLifecycle.ownsWake(signal),
    sceneFacts: () => agent.agent.getUserProfiles?.()?.scenes,
    recordState: (sessionKey, event, recordOptions) =>
      agent.agent.appendSessionEvents(sessionKey, [event], { create: recordOptions.create }),
    nickname: async (platform, userId) => {
      const record = await agent.agent.getUserProfiles?.()?.relations?.get(platform, userId);
      return record?.preferredAddress?.trim() || record?.displayName?.trim() || undefined;
    },
    readConversationContext: (conversation, consumer, through) =>
      im.readConversationContext(conversation, consumer, through, 50),
    commitConversationContext: (conversation, consumer, cursor) =>
      im.commitConversationContext(conversation, consumer, cursor),
    deliver: (conversation, output) => sendOutputMessages(output, {
      render: messageOutput => flattenOutputElements([...messageOutput]),
      send: async (messageOutput) => {
        // 没有原消息可回应：表情回应类输出直接视为不发。
        if (reactionOf(messageOutput) !== undefined) return { status: 'suppressed' as const };
        const adapter = capabilityLocalName(String(conversation.endpoint.id));
        const mediaAuthority = moderationMediaAuthority();
        const caps = resolveOutboundCapabilities(adapter, {
          capabilities: im.endpoints.capabilities({ adapter, endpointKey: adapter }),
          kind: conversation.kind as 'private' | 'group' | 'channel',
        });
        const content = await publishOutboundElements([...messageOutput], adapter || undefined, caps, mediaAuthority);
        if (content.length === 0) return { status: 'suppressed' as const };
        return deliveryOutcomeFromReceipt(await im.send({
          conversation, requester: rootPluginId(),
          content: untrustedContent(content, modelMediaTrust('agent:moderation', mediaAuthority, { maxInlineBytes: caps.maxAttachmentBytes })),
        }));
      },
    }),
    executeTurn: (request) => {
      const binding = agent.service.getBindingRegistry().requireZhinBinding();
      return runtime.execute(
        rootPluginId(),
        request,
        { binding, mcpServers: binding.mcpServers },
        observeAgentTurnTrace(agent.traceRuntime, request),
      );
    },
    timeoutMs: () => resolveTriggerTimeoutMs(agent.service.getTriggerConfig()),
    onSpoke,
  });
}

export function createMemberLifecycle(input: Readonly<{
  im: ImRuntime;
  agent: AgentIngressFoundationPort;
  onSpoke: (key: string) => void;
}>): MemberLifecycle {
  const { im, agent, onSpoke } = input;
  return new MemberLifecycle({
    sessionOps: () => agent.agent.getSessionOps?.(),
    controlPlane: () => agent.agent.getControlPlane?.(),
    sessions: () => agent.agent.getUserProfiles?.()?.sessions,
    reader: () => im.conversationEventReader,
    decisionEvents: () => agent.agent.getDecisionEvents?.(),
    send: async (conversation, parts) => {
      const content = parts.map((part) => (part.type === 'text'
        ? { type: 'text', data: { text: part.text } }
        : { type: 'mention', data: { target: part.id, ...(part.name ? { name: part.name } : {}) } }));
      if (content.length === 0) return { status: 'suppressed' as const };
      return deliveryOutcomeFromReceipt(await im.send({ conversation, requester: rootPluginId(), content }));
    },
    onSpoke,
  });
}
