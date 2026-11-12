import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { resolve } from 'node:path';
import { personalSessionIdentity, type PersonalSessionAddress } from '../../personal-session/index.js';
import { expandChatRole, hostChatRole, normalizeChatRoleLevels, type TurnCapabilities, type UserInteraction } from '@zhin.js/core';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import {
  approvalOutcomeToDecision,
  type ApprovalDecision,
  type ApprovalDecisionMemory,
  type ApprovalDecisionPort,
  type ApprovalOutcome,
  type ApprovalOutcomePort,
  type ApprovalRequestInput,
} from '../../session/approval-port.js';
import type { AIService } from '../../service.js';
import type {
  DeliveryOutcome,
  TurnAccessContext,
  TurnContextState,
  TurnRequest,
  TurnRequestPorts,
} from '../../turn/turn-ingress.js';
import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import { capabilityLocalName, type RuntimeSenderRoles } from './request-capabilities.js';

export const approvalMessages = createMessages({
  title: { 'zh-CN': '操作确认', en: 'Confirm operation' },
  humanTip: { 'zh-CN': '仅确认本次操作。', en: 'Confirmation applies to this operation only.' },
  tip: { 'zh-CN': '长期授权仅限当前 Host 和会话。', en: 'Remembered decisions apply only to this Host and conversation.' },
  reject: { 'zh-CN': '拒绝', en: 'Reject' },
  rejectAlways: { 'zh-CN': '拒绝本次及后续同类操作', en: 'Reject this and future matching operations' },
  once: { 'zh-CN': '允许一次', en: 'Allow once' },
  session: { 'zh-CN': '允许此会话', en: 'Allow for this conversation' },
  sessionLabel: { 'zh-CN': '允许此会话（所有人）', en: 'Allow in this conversation (everyone)' },
  always: { 'zh-CN': '始终允许', en: 'Always allow' },
  alwaysLabel: { 'zh-CN': '始终允许（本会话、仅此人）', en: 'Always allow (this conversation and sender)' },
});
const approvalText = approvalMessages;

export interface SandboxTurnPolicyInput {
  /** The turn's Endpoint declares `runtime.sandbox` (ADR 0044): the authenticated local sandbox ingress. */
  readonly runtimeSandbox: boolean;
  readonly isMaster: boolean;
  /** Conversation scope of the IM turn; IM shell access is only ever granted in private chats. */
  readonly scope?: 'private' | 'group' | 'channel';
  /** `ai.agent.masterShell`; anything but 'isolated' keeps bash disabled outside the sandbox. */
  readonly masterShell?: 'off' | 'isolated';
  /** `ai.agent.masterShellApprovalMode`; defaults to `ask` so the master is asked instead of silently reviewed. */
  readonly masterShellApprovalMode?: 'ask' | 'auto' | 'inherit';
  /** `ai.agent.execApprovalMode`; only read when `masterShellApprovalMode: inherit`. */
  readonly execApprovalMode?: 'ask' | 'auto' | 'bypass';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly projectRoot: string;
  readonly defaultNetwork?: TurnRequest['policy']['network'];
}

export interface ResolvedSandboxTurnPolicy {
  readonly filesystem: NonNullable<TurnRequest['policy']['filesystem']>;
  readonly shell?: TurnRequest['policy']['shell'];
  readonly network?: TurnRequest['policy']['network'];
}

/**
 * Sandbox is an authenticated local development ingress. Only its configured
 * owner may turn wire configuration into execution authority; all other IM
 * metadata is ignored and keeps the process defaults.
 */
export function resolveSandboxTurnPolicy(input: SandboxTurnPolicyInput): ResolvedSandboxTurnPolicy {
  const fallback = Object.freeze({
    filesystem: Object.freeze({
      workspaceRoot: input.projectRoot,
      workingDirectory: input.projectRoot,
      access: 'workspace-write' as const,
    }),
    ...(input.defaultNetwork ? { network: input.defaultNetwork } : {}),
  });
  if (!input.runtimeSandbox) {
    return allowsMasterImShell(input)
      ? Object.freeze({ ...fallback, shell: masterImIsolatedShell(resolveMasterShellApprovalMode(input)) })
      : fallback;
  }
  if (!input.isMaster) return fallback;
  const run = readRunConfig(input.metadata.sandboxAgentRun);
  if (!run) return fallback;

  const workingDirectory = path.resolve(input.projectRoot, run.workingDirectory || '.');
  const workspaceRoot = run.safetyMode === 'danger-full-access'
    ? path.parse(workingDirectory).root
    : workingDirectory;
  const network = run.networkAccess
    ? Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze([]) })
    : undefined;
  const shell: NonNullable<TurnRequest['policy']['shell']> = run.safetyMode === 'read-only'
    ? Object.freeze({
        preset: run.networkAccess ? 'network' : 'readonly',
        security: 'allowlist',
        execPreset: run.networkAccess ? 'network' : 'readonly',
        approvalMode: 'auto',
        isolation: 'required',
      })
    : run.safetyMode === 'workspace-write'
      ? Object.freeze({
          security: 'allowlist',
          execPreset: 'development',
          approvalMode: run.approvalMode,
          isolation: 'required',
        })
      : Object.freeze({
          security: 'full',
          execPreset: 'custom',
          approvalMode: 'bypass',
          isolation: 'none',
        });
  return Object.freeze({
    filesystem: Object.freeze({
      workspaceRoot,
      workingDirectory,
      access: run.safetyMode,
    }),
    shell,
    ...(network ? { network } : {}),
  });
}

function masterImIsolatedShell(approvalMode: 'ask' | 'auto' | 'bypass'): NonNullable<TurnRequest['policy']['shell']> {
  return Object.freeze({
    security: 'allowlist',
    execPreset: 'development',
    approvalMode,
    isolation: 'required',
  });
}

export function resolveMasterShellApprovalMode(
  input: Pick<SandboxTurnPolicyInput, 'masterShellApprovalMode' | 'execApprovalMode'>,
): 'ask' | 'auto' | 'bypass' {
  switch (input.masterShellApprovalMode) {
    case 'auto':
      return 'auto';
    case 'inherit':
      return input.execApprovalMode ?? 'auto';
    default:
      return 'ask';
  }
}

function allowsMasterImShell(input: SandboxTurnPolicyInput): boolean {
  return input.masterShell === 'isolated' && input.isMaster && input.scope === 'private';
}

function readRunConfig(value: unknown): Readonly<{
  workingDirectory: string;
  safetyMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalMode: 'ask' | 'auto' | 'bypass';
  networkAccess: boolean;
}> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.workingDirectory !== 'string') return undefined;
  if (item.safetyMode !== 'read-only' && item.safetyMode !== 'workspace-write' && item.safetyMode !== 'danger-full-access') return undefined;
  if (item.approvalMode !== 'ask' && item.approvalMode !== 'auto' && item.approvalMode !== 'bypass') return undefined;
  return {
    workingDirectory: item.workingDirectory.trim().slice(0, 4096),
    safetyMode: item.safetyMode,
    approvalMode: item.approvalMode,
    networkAccess: item.safetyMode === 'danger-full-access' || item.networkAccess === true,
  };
}

/** IM adapter for the origin-neutral interaction authority. */
export function createRuntimeQuestionPort(
  im: ImRuntime,
  message: Message,
): NonNullable<TurnRequestPorts['question']> {
  const interaction = im.createInteraction(message);
  if (!interaction) throw new Error('User interaction is unavailable for this message');
  return Object.freeze({
    async ask(request: Parameters<NonNullable<TurnRequestPorts['question']>['ask']>[0]) {
      const options = {
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      };
      if (request.type === 'text') {
        const value = await interaction.ask({ type: 'text', title: request.question, ...options });
        return Object.freeze({ type: 'text' as const, value });
      }
      if (request.type === 'number') {
        const numericDefault = request.defaultValue === undefined
          ? undefined
          : Number(request.defaultValue);
        const value = await interaction.ask({
          type: 'number',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(Number.isFinite(numericDefault) ? { default: numericDefault } : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'number' as const, value });
      }
      if (request.type === 'confirm') {
        const value = await interaction.ask({
          type: 'confirm',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(request.defaultValue !== undefined
            ? { default: /^(?:y|yes|true|1|是|确认|同意)$/i.test(request.defaultValue) }
            : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'confirm' as const, value });
      }
      const choices = request.options ?? [];
      const value = await interaction.ask({
        type: 'select',
        title: request.question,
        options: choices.map((label) => ({ label, value: label })),
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      }) as string;
      return Object.freeze({ type: 'pick' as const, value, index: choices.indexOf(value) });
    },
  });
}

/** IM approvals use UserInteraction; human-only tools also require a fresh answer from masters. */
export function createRuntimeApprovalPort(options: {
  readonly locale?: Locale;
  readonly isMaster: boolean;
  readonly interaction?: UserInteraction;
  readonly memory?: ApprovalDecisionMemory;
}): ApprovalDecisionPort & ApprovalOutcomePort {
  const locale = resolveLocale(options.locale);
  const port: ApprovalDecisionPort & ApprovalOutcomePort = {
    available: options.isMaster || options.interaction != null,
    async requestApprovalOutcome(input: ApprovalRequestInput): Promise<ApprovalOutcome> {
      if (options.isMaster && !input.humanOnly) return { status: 'approved', decision: 'approve-always' };
      if (!options.interaction) {
        return { status: 'unavailable', reason: 'this conversation cannot show an approval prompt' };
      }
      const recalled = input.humanOnly ? undefined : options.memory?.recall(input);
      if (recalled !== undefined) {
        return recalled
          ? { status: 'approved', decision: 'approve-always' }
          : { status: 'denied', by: 'remembered' };
      }
      const sharedConversation = input.conversationScope === 'group'
        || input.conversationScope === 'channel';
      try {
        // No `default`: a timeout must surface as timed_out, not as a silent rejection.
        const selected = await options.interaction.ask({
          type: 'select',
          title: approvalText(locale, 'title'),
          description: input.question,
          tip: approvalText(locale, input.humanOnly ? 'humanTip' : 'tip'),
          options: [
            { label: approvalText(locale, input.humanOnly ? 'reject' : 'rejectAlways'), value: 'reject',
              aliases: locale === 'en' ? ['n', 'no', 'Reject'] : ['否', '拒绝'] },
            { label: approvalText(locale, 'once'), value: 'approve-once', aliases: locale === 'en' ? ['y', 'yes'] : ['同意', '确认'] },
            ...(sharedConversation && !input.humanOnly ? [
              { label: approvalText(locale, 'sessionLabel'), value: 'approve-session', aliases: [approvalText(locale, 'session')] },
            ] : []),
            ...(!input.humanOnly ? [{
              label: approvalText(locale, 'alwaysLabel'),
              value: 'approve-always',
              aliases: [approvalText(locale, 'always')],
            }] : []),
          ],
          ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
          signal: input.signal,
        });
        const decision = input.humanOnly
          ? selected === 'approve-once' ? 'approve-once' : 'reject'
          : normalizeApprovalDecision(selected, sharedConversation);
        if (!input.humanOnly) options.memory?.remember(input, decision);
        return decision === 'reject' ? { status: 'denied', by: 'user' } : { status: 'approved', decision };
      } catch (error) {
        return approvalOutcomeFromInteractionError(error);
      }
    },
    async requestApprovalDecision(input: ApprovalRequestInput): Promise<ApprovalDecision> {
      return approvalOutcomeToDecision(await port.requestApprovalOutcome(input));
    },
    async requestApproval(input: ApprovalRequestInput) {
      return (await port.requestApprovalOutcome(input)).status === 'approved';
    },
  };
  return Object.freeze(port);
}

function approvalOutcomeFromInteractionError(error: unknown): ApprovalOutcome {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'UserInteractionTimeoutError':
      return { status: 'timed_out' };
    case 'UserInteractionDeliveryError':
      return { status: 'unavailable', reason: 'the approval prompt could not be delivered' };
    case 'UserInteractionSupersededError':
      return { status: 'unavailable', reason: 'the approval prompt was superseded by another question' };
    default:
      return { status: 'unavailable', reason: 'the approval prompt failed' };
  }
}

function normalizeApprovalDecision(value: unknown, sharedConversation: boolean): ApprovalDecision {
  if (value === 'reject' || value === 'approve-once' || value === 'approve-always') return value;
  if (sharedConversation && value === 'approve-session') return value;
  return 'reject';
}

export function deliveryOutcomeFromReceipt(
  receipt: Awaited<ReturnType<Message['$reply']>>,
  plannedText?: string,
): DeliveryOutcome {
  const messages = receipt.parts
    ? receipt.parts.map(part => part.message ?? null)
    : receipt.message ? [receipt.message] : [];
  const partSequences = receipt.parts
    ? receipt.parts.map(part => (
      typeof part.conversationSequence === 'number' && Number.isFinite(part.conversationSequence)
        ? part.conversationSequence
        : null
    ))
    : undefined;
  const hasPartSequence = partSequences?.some((seq): seq is number => seq !== null) ?? false;
  const primarySequence = typeof receipt.conversationSequence === 'number' && Number.isFinite(receipt.conversationSequence)
    ? receipt.conversationSequence
    : partSequences?.find((seq): seq is number => seq !== null);
  const sequenceProps = {
    ...(primarySequence !== undefined ? { conversationSequence: primarySequence } : {}),
    ...(hasPartSequence && partSequences ? { conversationSequences: partSequences } : {}),
  };
  switch (receipt.status) {
    case 'sent':
      return {
        status: 'sent' as const,
        ...(messages.length ? { messages } : {}),
        ...(receipt.message?.id
          ? { messageId: receipt.message.id, ...(plannedText !== undefined && receipt.outboundTextDigest === createHash('sha256').update(plannedText).digest('hex')
            ? { messageContexts: [{ message: receipt.message, plannedText }] } : {}) }
          : {}),
        ...sequenceProps,
      };
    case 'suppressed':
      return { status: 'suppressed' as const };
    case 'unsupported':
      return {
        status: 'unsupported' as const,
        code: receipt.failure?.code ?? 'outbound_unsupported',
        ...(messages.length ? { messages } : {}),
        ...sequenceProps,
      };
    case 'rejected':
      return {
        status: 'rejected' as const,
        code: receipt.failure?.code ?? 'outbound_payload_rejected',
        ...(messages.length ? { messages } : {}),
        ...sequenceProps,
      };
    case 'failed':
      return {
        status: 'failed' as const,
        code: receipt.failure?.code ?? 'endpoint_send_failed',
        retryable: !messages.some(message => message !== null) && receipt.failure?.retryable === true,
        ...(receipt.failure?.deliveryUnknown ? { deliveryUnknown: true as const } : {}),
        ...(messages.length ? { messages } : {}),
        ...sequenceProps,
      };
  }
}

export function interactiveNetworkPolicy(
  config: ReturnType<AIService['getAgentConfig']>,
): TurnRequest['policy']['network'] | undefined {
  const network = config?.network;
  // An explicit `network.enabled` wins; unset keeps the legacy `execPreset: network` switch.
  const enabled = network?.enabled ?? config?.execPreset === 'network';
  if (!enabled) return undefined;
  const allowedDomains = (network?.allowedDomains ?? [])
    .map(domain => String(domain).trim())
    .filter(Boolean);
  return Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze(allowedDomains) });
}

function resolveChannelId(message: Message): string {
  const id = message.conversation.id.trim();
  if (!id) throw new TypeError('Runtime IM ingress requires scene identity');
  return id;
}

export function createRuntimeTurnAccess(
  message: Message,
  roles: RuntimeSenderRoles,
  contextState?: TurnContextState,
  platformCapabilities?: TurnCapabilities,
  conversationSequence?: number,
): TurnAccessContext {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpoint = message.endpointId?.trim();
  if (!endpoint) throw new TypeError('Runtime IM ingress requires endpoint identity');
  const subjectId = message.sender?.id?.trim();
  if (!subjectId) throw new TypeError('Runtime IM ingress requires authenticated sender identity');
  // Fail closed: only human-origin messages may construct an agent turn.
  const messageOrigin = message.origin;
  if (messageOrigin !== undefined && messageOrigin !== 'human') {
    throw new TypeError(`Runtime IM ingress rejects non-human origin: ${String(messageOrigin)}`);
  }
  const scope = message.conversation.kind;
  // ADR 0056: zhin chat roles only (expanded, owner → owner/admin/trusted); platform standing
  // stays on `sender.platform` and never becomes an authorization role. `roles` carry host-wide
  // trust: `owner` only for a global owner (a lower-level owner counts as admin here); the chain
  // role itself (permits such as `owner`) is kept on `principal.chatRole`.
  const hostRole = message.sender?.id ? hostChatRole(message.sender) : undefined;
  const chatRoles = roles.isMaster ? expandChatRole('owner')
    : hostRole ? expandChatRole(hostRole) : roles.isTrusted ? expandChatRole('trusted') : [];
  const chainRole = message.sender?.id ? message.sender.chatRole : undefined;
  const chainLevels = chainRole ? normalizeChatRoleLevels(message.sender?.chatRoleLevels) : undefined;
  const principalRoles: string[] = chatRoles.length ? [...chatRoles] : ['user'];
  const hasValidConversationSequence = typeof conversationSequence === 'number' && Number.isFinite(conversationSequence);
  return Object.freeze({
    ...(contextState || platformCapabilities
      ? { input: Object.freeze({
          ...(contextState ? { contextState } : {}),
          ...(platformCapabilities ? { platformCapabilities } : {}),
        }) }
      : {}),
    origin: Object.freeze({
      kind: 'im' as const,
      conversation: message.conversation,
      ...(message.conversation.threadId ? { threadId: message.conversation.threadId } : {}),
      platform,
      endpoint,
      scope,
      sceneId: resolveChannelId(message),
      ...(message.id ? { messageId: message.id } : {}),
      ...(hasValidConversationSequence ? { conversationSequence } : {}),
    }),
    principal: Object.freeze({
      subjectId,
      ...(message.sender?.name ? { displayName: message.sender.name } : {}),
      roles: Object.freeze(principalRoles),
      ...(chainRole ? { chatRole: chainRole } : {}),
      ...(chainLevels ? { chatRoleLevels: chainLevels } : {}),
      ...(message.sender?.platform ? { platform: message.sender.platform } : {}),
      ...(messageOrigin ? { origin: messageOrigin } : {}),
    }),
    policy: Object.freeze({
      permissions: Object.freeze(principalRoles),
      unattended: false,
    }),
  });
}

/** Trusted IM identity used by Session ownership and model selection alike. */
export function runtimePersonalSessionAddress(access: TurnAccessContext, projectRoot: string): PersonalSessionAddress {
  const origin = access.origin;
  if (origin.kind !== 'im') throw new TypeError('Runtime IM access requires an IM origin');
  if (!origin.conversation) throw new TypeError('Personal Session requires a canonical conversation');
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) throw new TypeError('Personal Session requires a trusted Host project root');
  return personalSessionIdentity({
    rootId: resolve(projectRoot),
    platform: origin.platform,
    endpoint: origin.endpoint,
    conversation: origin.conversation,
    subjectId: access.principal.subjectId,
  }).address;
}

export function runtimeImSessionKey(access: TurnAccessContext, projectRoot: string): string {
  return personalSessionIdentity(runtimePersonalSessionAddress(access, projectRoot)).key;
}

/** System-owned scene work: no participant or personal preset participates in identity. */
export function runtimeSceneTaskSessionKey(access: Pick<TurnAccessContext, 'origin'>, projectRoot: string): string {
  const origin = access.origin;
  if (origin.kind !== 'im' || !origin.conversation) throw new TypeError('Scene task requires a canonical IM conversation');
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) throw new TypeError('Scene task requires a trusted Host project root');
  const conversation = origin.conversation;
  const identity = [resolve(projectRoot), origin.platform, origin.endpoint,
    conversation.endpoint.adapter, conversation.endpoint.id, conversation.kind, conversation.id,
    conversation.parent ? [conversation.parent.kind, conversation.parent.id] : null, conversation.threadId ?? null];
  return `scene-task:v1:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

/** A small non-interactive ApprovalPort suitable for CLI/service hosts and tests. */
export function createDeterministicApprovalPort(
  decision: 'approve' | 'deny' = 'deny',
): ApprovalOutcomePort {
  const port: ApprovalOutcomePort = {
    available: true,
    requestApprovalOutcome: async input => input.humanOnly
      ? { status: 'unavailable', reason: 'this non-interactive host cannot obtain fresh human approval' }
      : decision === 'approve' ? { status: 'approved', decision: 'approve-once' } : { status: 'denied', by: 'user' },
    requestApproval: async input => (await port.requestApprovalOutcome(input)).status === 'approved',
  };
  return port;
}
