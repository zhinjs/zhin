import {
  DANGEROUS_TOOL_CATEGORY_LABELS,
  imApproversFor,
  isImApprovalDeliverable,
  isImApprover,
  type ToolApprovalChannel,
  type ToolApprovalEntry,
  type ToolApprovalQueue,
  type ToolHardGateImApprovalSettings,
} from '@zhin.js/agent/security';

/**
 * IM approval channel for the dangerous-tool hard gate (G6, #1013).
 *
 * - Delivery: every new card in the Agent's {@link ToolApprovalQueue} is sent to the allowlisted approvers
 *   of the platform that triggered it, privately (`dm`, default) or to the dedicated approver group
 *   (`approver_group`, never the conversation that triggered the call).
 * - Settlement: an approver answers with the fixed commands `approve <id>` / `deny <id>`. The command
 *   resolves the same queue the Console uses, so whichever channel answers first wins and the other
 *   sees the card as already decided. One answer settles exactly one card: no session or permanent grants.
 * - Safety: the sender must be on the allowlist for that platform, the command must come from a private
 *   chat (or the configured approver group), and never from the conversation that triggered the call.
 *   This is a Host command path, not a model-callable tool, so bypass / auto-review cannot reach it.
 */

/** Recorded as `decidedBy` for IM settlements: `im:<platform>:<userId>`. */
export function imApprovalOperatorId(platform: string, userId: string): string {
  return `im:${platform}:${userId}`;
}

export interface ImApprovalDeliveryTarget {
  /** Adapter local name of the Endpoint that delivers the card. */
  readonly platform: string;
  /** Endpoint live name; the card goes out through the Endpoint that saw the dangerous call. */
  readonly endpointKey: string;
  readonly conversation: Readonly<{ kind: 'private' | 'group'; id: string }>;
}

export type ImApprovalSender = (target: ImApprovalDeliveryTarget, text: string) => Promise<void>;

export interface ImApprovalDeliveryReport {
  readonly status: 'delivered' | 'partial' | 'failed' | 'unavailable';
  readonly delivered: number;
  readonly attempted: number;
}

export interface ImApprovalCommandInput {
  readonly platform: string;
  readonly scope: 'private' | 'group' | 'channel';
  /** Native conversation id of the message (group id, channel id, or the private peer). */
  readonly sceneId: string;
  readonly senderId: string;
  /** Command text with the dispatcher prefix already removed; undefined when the message is not a command. */
  readonly commandText: string | undefined;
}

export interface ImToolApprovalChannelOptions {
  readonly queue: ToolApprovalQueue;
  /** Read live so a config reload applies to the next card. */
  readonly settings: () => ToolHardGateImApprovalSettings;
  readonly send: ImApprovalSender;
  readonly onDeliveryError?: (error: unknown, target: ImApprovalDeliveryTarget) => void;
}

const APPROVAL_COMMAND = /^(approve|deny)\s+(tap_[0-9a-z_]+)\s*$/iu;
const ARGS_PREVIEW_LIMIT = 300;

export class ImToolApprovalChannel {
  readonly #options: ImToolApprovalChannelOptions;
  readonly #inFlight = new Set<Promise<ImApprovalDeliveryReport>>();

  constructor(options: ImToolApprovalChannelOptions) {
    this.#options = options;
  }

  /** Starts delivering new cards; returns a stop function. */
  start(): () => void {
    return this.#options.queue.onEnqueue((entry) => {
      const delivery = this.deliver(entry);
      this.#inFlight.add(delivery);
      void delivery.finally(() => this.#inFlight.delete(delivery));
    });
  }

  /** Resolves once every delivery started so far has finished (tests and orderly shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#inFlight]);
  }

  /**
   * Sends one card to its approvers. Never throws: an undeliverable card stays pending for the Console
   * and times out to a denial like any other card.
   */
  async deliver(entry: ToolApprovalEntry): Promise<ImApprovalDeliveryReport> {
    const settings = this.#options.settings();
    const origin = entry.origin;
    if (!origin || !isImApprovalDeliverable(settings, origin)) {
      return { status: 'unavailable', delivered: 0, attempted: 0 };
    }
    const text = formatImApprovalCard(entry, settings.delivery);
    const targets = deliveryTargets(settings, origin.platform, origin.endpointKey);
    let delivered = 0;
    for (const target of targets) {
      try {
        await this.#options.send(target, text);
        delivered += 1;
      } catch (error) {
        this.#options.onDeliveryError?.(error, target);
      }
    }
    return { status: deliveryStatus(delivered, targets.length), delivered, attempted: targets.length };
  }

  /**
   * Handles `approve <id>` / `deny <id>` for hard-gate cards. Returns null for anything else so the
   * owner `/approve …` commands keep working; otherwise returns the reply text.
   */
  handleCommand(input: ImApprovalCommandInput): string | null {
    const match = input.commandText ? APPROVAL_COMMAND.exec(input.commandText) : null;
    if (!match) return null;
    const approve = match[1]!.toLowerCase() === 'approve';
    const approvalId = match[2]!;
    const settings = this.#options.settings();
    if (!settings.enabled) return 'IM 审批通道未开启，请在 Console 处理该审批卡片。';
    const channel = commandChannel(settings, input);
    if (!channel) {
      return settings.delivery === 'approver_group'
        ? '危险工具审批只能在私聊或指定的审批群中处理，本会话的消息不会结算审批卡片。'
        : '危险工具审批只能在与 Bot 的私聊中处理，群内消息不会结算审批卡片。';
    }
    if (!isImApprover(settings, input.platform, input.senderId)) {
      return '你不在危险工具审批人名单中，无法处理审批卡片。';
    }
    const queue = this.#options.queue;
    const current = queue.get(approvalId);
    if (!current || !current.origin || current.origin.platform !== input.platform) {
      return `未找到审批卡片 ${approvalId}。`;
    }
    if (isOriginConversation(current, input)) {
      return '不能在触发该操作的会话中处理审批卡片。';
    }
    if (current.status !== 'pending') return `审批卡片 ${approvalId} 已${statusLabel(current.status)}，无需重复处理。`;
    const settled = queue.resolve(approvalId, approve, imApprovalOperatorId(input.platform, input.senderId), { channel });
    if (!settled) {
      const latest = queue.get(approvalId);
      return `审批卡片 ${approvalId} 已${statusLabel(latest?.status ?? 'expired')}，无需重复处理。`;
    }
    return approve
      ? `已批准 ${approvalId}（${settled.toolName}），仅对这一次同参数调用生效。`
      : `已拒绝 ${approvalId}（${settled.toolName}）。`;
  }
}

/** Card text: tool, category, conversation, redacted arguments, id, expiry, and the two commands. */
export function formatImApprovalCard(
  entry: ToolApprovalEntry,
  delivery: ToolHardGateImApprovalSettings['delivery'],
  commandPrefix = '/',
): string {
  const origin = entry.origin;
  const conversation = origin ? `${origin.platform} ${origin.scope ?? 'scene'}:${origin.sceneId}` : entry.sessionKey;
  const category = entry.category ? `（${DANGEROUS_TOOL_CATEGORY_LABELS[entry.category]}）` : '';
  return [
    `【危险工具审批】${entry.toolName}${category}`,
    `会话：${conversation}`,
    entry.requesterId ? `发起人：${entry.requesterId}` : undefined,
    `参数：${previewArgs(entry.args)}`,
    `审批卡片：${entry.id}`,
    `过期时间：${formatExpiry(entry.expiresAt)}（超时自动拒绝）`,
    `批准：${commandPrefix}approve ${entry.id}`,
    `拒绝：${commandPrefix}deny ${entry.id}`,
    delivery === 'approver_group'
      ? '仅名单内审批人可处理；一次批准只放行这一次同参数调用，也可在 Console 处理。'
      : '一次批准只放行这一次同参数调用，也可在 Console 处理。',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function deliveryTargets(
  settings: ToolHardGateImApprovalSettings,
  platform: string,
  endpointKey: string,
): readonly ImApprovalDeliveryTarget[] {
  if (settings.delivery === 'approver_group') {
    if (!settings.approverGroupId) return [];
    return [{ platform, endpointKey, conversation: { kind: 'group', id: settings.approverGroupId } }];
  }
  return imApproversFor(settings, platform).map((userId) => ({
    platform,
    endpointKey,
    conversation: { kind: 'private' as const, id: userId },
  }));
}

function deliveryStatus(delivered: number, attempted: number): ImApprovalDeliveryReport['status'] {
  if (attempted === 0) return 'unavailable';
  if (delivered === attempted) return 'delivered';
  return delivered === 0 ? 'failed' : 'partial';
}

/** Private chats always count as `im_dm`; the approver group only when explicitly configured. */
function commandChannel(settings: ToolHardGateImApprovalSettings, input: ImApprovalCommandInput): ToolApprovalChannel | null {
  if (input.scope === 'private') return 'im_dm';
  const inApproverGroup = settings.delivery === 'approver_group'
    && settings.approverGroupId !== null
    && input.scope === 'group'
    && input.sceneId === settings.approverGroupId;
  return inApproverGroup ? 'im_approver_group' : null;
}

/** The conversation that triggered the dangerous call can never settle its own card. */
function isOriginConversation(entry: ToolApprovalEntry, input: ImApprovalCommandInput): boolean {
  const origin = entry.origin;
  if (!origin || origin.scope === 'private') return false;
  return origin.scope === input.scope && origin.sceneId === input.sceneId;
}

function statusLabel(status: ToolApprovalEntry['status']): string {
  switch (status) {
    case 'approved':
      return '批准';
    case 'consumed':
      return '批准并执行';
    case 'denied':
      return '拒绝';
    case 'expired':
      return '过期';
    default:
      return '处理';
  }
}

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
}

function previewArgs(args: ToolApprovalEntry['args']): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = String(args);
  }
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT - 1)}…` : text;
}
