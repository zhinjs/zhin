import {
  MAX_IM_DIFF_EXCERPT_BYTES,
  MAX_IM_DIFF_EXCERPT_LINES,
  SELF_CHANGE_APPROVAL_TOOL,
  type SelfChangeApprovalArgs,
} from '../../index.js';
import type { SendContent } from '@zhin.js/core';
import { formatDateTime, formatList, type Locale } from '@zhin.js/plugin-runtime';
import { cardLine, cardLiteral, joinCardLines, type CardLine, type CardValues } from '../../init/card-text.js';
import { managementCommandReference, type AgentCommandPresentation } from '../../init/command-presentation.js';
import {
  imApproversFor,
  isImApprovalDeliverable,
  isImApprover,
  type ToolApprovalChannel,
  type ToolApprovalEntry,
  type ToolApprovalQueue,
  type ToolHardGateImApprovalSettings,
} from '../../security/index.js';
import type { ImApprovalCommandInput } from '../ingress/ports.js';
import { toolApprovalImMessages as t } from './tool-approval-im-messages.js';

/**
 * IM approval channel for the dangerous-tool hard gate (G6, #1013).
 *
 * - Delivery: every new card in the Agent's {@link ToolApprovalQueue} is sent to the allowlisted approvers
 *   of the platform that triggered it, privately (`dm`, default) or to the dedicated approver group
 *   (`approver_group`, never the conversation that triggered the call).
 * - Settlement: an approver answers with the fixed commands `approve <id>` / `deny <id>`, written on the
 *   card with the recipient Endpoint's real command prefix (#1250) and parsed after that prefix. The command
 *   resolves the same queue the Console uses, so whichever channel answers first wins and the other
 *   sees the card as already decided. One answer settles exactly one card: no session or permanent grants.
 * - Safety: the sender must be on the allowlist for that platform, the command must come from a private
 *   chat (or the configured approver group), and never from the conversation that triggered the call.
 *   This is a Host command path, not a model-callable tool, so bypass / auto-review cannot reach it.
 * - Self-change cards (ADR 0040 §4, slice D): the approvers are the endpoint owner (master) plus the allowlist.
 *   The card always goes to the owner's private chat — also when the change was started in a business group and
 *   also when the G6 channel is off — and the owner may settle it there; allowlisted approvers get it only when
 *   G6 is on, through the configured delivery. A group (other than the approver group) never settles a card.
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

/**
 * Sends one card. The content mixes framework text with literal pieces (`untrustedContent`) for every
 * user / model / plugin value, so the outbound template step cannot rewrite what the approver reads.
 */
export type ImApprovalSender = (target: ImApprovalDeliveryTarget, content: SendContent) => Promise<void>;

export interface ImApprovalDeliveryReport {
  readonly status: 'delivered' | 'partial' | 'failed' | 'unavailable';
  readonly delivered: number;
  readonly attempted: number;
}

export interface ImToolApprovalChannelOptions {
  readonly queue: ToolApprovalQueue;
  /** Read live so a config reload applies to the next card. */
  readonly settings: () => ToolHardGateImApprovalSettings;
  readonly send: ImApprovalSender;
  /** Endpoint owner (master); receives and may settle self-change cards. */
  readonly resolveOwner?: (platform: string, endpointKey: string) => string | undefined;
  readonly onDeliveryError?: (error: unknown, target: ImApprovalDeliveryTarget) => void;
  /**
   * #1250: the recipient's command presentation (the Endpoint's real command prefix and the recipient's
   * display language), so the card spells `approve <id>` the way the ingress dispatcher parses it.
   * Absent or unresolved: the card shows the bare command and asks for this account's prefix.
   */
  readonly resolvePresentation?: (
    target: ImApprovalDeliveryTarget,
  ) => AgentCommandPresentation | undefined | Promise<AgentCommandPresentation | undefined>;
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
    if (!origin) return { status: 'unavailable', delivered: 0, attempted: 0 };
    const owner = isSelfChangeCard(entry) ? this.#owner(origin.platform, origin.endpointKey) : undefined;
    const targets = [
      ...(isImApprovalDeliverable(settings, origin) ? deliveryTargets(settings, origin.platform, origin.endpointKey) : []),
    ];
    if (owner && !targets.some(target => target.conversation.kind === 'private' && target.conversation.id === owner)) {
      targets.unshift({ platform: origin.platform, endpointKey: origin.endpointKey, conversation: { kind: 'private', id: owner } });
    }
    if (targets.length === 0) return { status: 'unavailable', delivered: 0, attempted: 0 };
    let delivered = 0;
    for (const target of targets) {
      try {
        const card = formatImApprovalCard(entry, settings.delivery, await this.#presentation(target));
        await this.#options.send(target, card);
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
    const queue = this.#options.queue;
    const current = queue.get(approvalId);
    const selfChange = current !== undefined && isSelfChangeCard(current);
    // Any global owner settles a self-change card (ADR 0056 §2), not only the owner it was delivered to.
    const ownerSettles = selfChange && current.origin !== null && current.origin.platform === input.platform
      && (input.senderIsGlobalOwner === true
        || this.#owner(current.origin.platform, current.origin.endpointKey) === input.senderId.trim());
    const locale = input.locale;
    if (!settings.enabled && !ownerSettles) {
      return t(locale, selfChange && input.scope !== 'private' ? 'selfPrivateOnly' : 'channelOff');
    }
    const channel = ownerSettles && input.scope === 'private' ? 'im_dm' : commandChannel(settings, input);
    if (!channel) {
      return t(locale, settings.delivery === 'approver_group' && settings.enabled ? 'privateOrGroupOnly' : 'privateOnly');
    }
    if (!ownerSettles && !isImApprover(settings, input.platform, input.senderId)) {
      return t(locale, 'notApprover');
    }
    if (!current || !current.origin || current.origin.platform !== input.platform) {
      return t(locale, 'notFound', { id: approvalId });
    }
    if (isOriginConversation(current, input)) {
      return t(locale, 'originConversation');
    }
    if (current.status !== 'pending') {
      return t(locale, 'alreadyDecided', { id: approvalId, status: statusLabel(current.status, locale) });
    }
    const settled = queue.resolve(approvalId, approve, imApprovalOperatorId(input.platform, input.senderId), { channel });
    if (!settled) {
      const latest = queue.get(approvalId);
      return t(locale, 'alreadyDecided', { id: approvalId, status: statusLabel(latest?.status ?? 'expired', locale) });
    }
    if (selfChange) {
      const changeId = (settled.args as Partial<SelfChangeApprovalArgs>).changeId ?? '';
      return t(locale, approve ? 'selfApproved' : 'selfRejected', { change: changeId, id: approvalId });
    }
    return t(locale, approve ? 'approved' : 'denied', { id: approvalId, tool: settled.toolName });
  }

  async #presentation(target: ImApprovalDeliveryTarget): Promise<AgentCommandPresentation> {
    try {
      return (await this.#options.resolvePresentation?.(target)) ?? {};
    } catch {
      return {};
    }
  }

  #owner(platform: string, endpointKey: string): string | undefined {
    try {
      return this.#options.resolveOwner?.(platform, endpointKey)?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}

function isSelfChangeCard(entry: ToolApprovalEntry): boolean {
  return entry.category === 'self' && entry.toolName === SELF_CHANGE_APPROVAL_TOOL;
}

type DangerousCategory = NonNullable<ToolApprovalEntry['category']>;

/** One catalog line in `locale`; {@link cardLiteral} values stay literal pieces. */
function line(locale: Locale | undefined, key: Parameters<typeof t>[1], values?: CardValues): CardLine {
  return cardLine(plain => t(locale, key, plain), values);
}

const CATEGORY_KEYS: Readonly<Record<DangerousCategory, Parameters<typeof t>[1]>> = Object.freeze({
  member: 'categoryMember',
  publish: 'categoryPublish',
  funds: 'categoryFunds',
  identity: 'categoryIdentity',
  self: 'categorySelf',
});

/**
 * The two card commands as the recipient sends them: `<prefix>approve <id>` with the Endpoint's real
 * prefix (#1250, the same `managementCommandText` strip the ingress applies before matching). An unknown
 * prefix shows the bare command and one line asking for this account's prefix.
 */
function cardCommands(entry: ToolApprovalEntry, presentation: AgentCommandPresentation): Readonly<{
  approve: string;
  deny: string;
  hint: string | undefined;
}> {
  const prefix = presentation.commandPrefix;
  return {
    approve: managementCommandReference(`approve ${entry.id}`, prefix) ?? `approve ${entry.id}`,
    deny: managementCommandReference(`deny ${entry.id}`, prefix) ?? `deny ${entry.id}`,
    hint: prefix === undefined ? t(presentation.locale, 'cardPrefixUnknown') : undefined,
  };
}

/**
 * Card text: tool, category, conversation, redacted arguments, id, expiry, and the two commands, in the
 * recipient's language and with the recipient Endpoint's command prefix (#1250).
 */
export function formatImApprovalCard(
  entry: ToolApprovalEntry,
  delivery: ToolHardGateImApprovalSettings['delivery'],
  presentation: AgentCommandPresentation = {},
): SendContent {
  if (isSelfChangeCard(entry)) return formatSelfChangeCard(entry, presentation);
  const locale = presentation.locale;
  const origin = entry.origin;
  const conversation = origin ? `${origin.platform} ${origin.scope ?? 'scene'}:${origin.sceneId}` : entry.sessionKey;
  const category = entry.category ? t(locale, 'cardCategory', { label: t(locale, CATEGORY_KEYS[entry.category]) }) : '';
  const commands = cardCommands(entry, presentation);
  // Tool name, conversation, requester and arguments are plugin / platform / model values: literal.
  return joinCardLines([
    line(locale, 'cardTitle', { tool: cardLiteral(entry.toolName), category }),
    line(locale, 'cardConversation', { conversation: cardLiteral(conversation) }),
    entry.requesterId ? line(locale, 'cardRequester', { id: cardLiteral(entry.requesterId) }) : undefined,
    line(locale, 'cardArgs', { args: cardLiteral(previewArgs(entry.args)) }),
    line(locale, 'cardId', { id: entry.id }),
    line(locale, 'cardExpiryDeny', { time: formatExpiry(entry.expiresAt, locale) }),
    line(locale, 'cardApprove', { command: commands.approve }),
    line(locale, 'cardDeny', { command: commands.deny }),
    commands.hint,
    line(locale, delivery === 'approver_group' ? 'cardFooterGroup' : 'cardFooterDm'),
  ]);
}

/**
 * Self-change card (ADR 0040 §4, #1142 F3): summary, diff counts, a bounded diff excerpt (≤ 40 lines / 2 KB,
 * already cut and redacted when the card was enqueued), impact, trial verdict with the skipped check names, and
 * a reminder not to approve blind. Never full file bodies or config values.
 */
export function formatSelfChangeCard(entry: ToolApprovalEntry, presentation: AgentCommandPresentation = {}): SendContent {
  const locale = presentation.locale;
  const args = entry.args as Partial<SelfChangeApprovalArgs>;
  const origin = entry.origin;
  const conversation = origin ? `${origin.platform} ${origin.scope ?? 'scene'}:${origin.sceneId}` : entry.sessionKey;
  const files = Array.isArray(args.files) ? args.files : [];
  const configPaths = Array.isArray(args.configPaths) ? args.configPaths : [];
  const shown = files.slice(0, 10).map(file => line(locale, 'selfFile', {
    kind: cardLiteral(file.kind), path: cardLiteral(file.path), added: Number(file.added) || 0, removed: Number(file.removed) || 0,
  }));
  const impact = impactLabel(args.impact, locale);
  const impactDetail = Array.isArray(args.impactDetail) && args.impactDetail.length > 0
    ? formatList(locale, args.impactDetail, { separator: 'semicolon' })
    : undefined;
  const commands = cardCommands(entry, presentation);
  // Summary, ids, paths, the diff excerpt and the trial details come from the model, the change or the
  // platform: literal pieces on their own line, so they cannot be compiled or forge a command line.
  return joinCardLines([
    line(locale, 'selfTitle', { summary: cardLiteral(args.summary || args.changeId || entry.id) }),
    line(locale, 'selfChange', { id: cardLiteral(args.changeId ?? '-') }),
    entry.requesterId
      ? line(locale, 'selfOriginBy', { conversation: cardLiteral(conversation), requester: cardLiteral(entry.requesterId) })
      : line(locale, 'selfOrigin', { conversation: cardLiteral(conversation) }),
    files.length > 0 ? line(locale, 'selfFiles', { count: files.length }) : undefined,
    ...shown,
    files.length > shown.length ? line(locale, 'selfMoreFiles', { count: files.length - shown.length }) : undefined,
    configPaths.length > 0 ? line(locale, 'selfConfig', { paths: cardLiteral(formatList(locale, configPaths, { separator: 'comma' })) }) : undefined,
    ...diffExcerptLines(args, locale),
    impactDetail === undefined
      ? line(locale, 'selfImpact', { impact })
      : line(locale, 'selfImpactDetail', { impact, detail: cardLiteral(impactDetail) }),
    trialLine(args, locale),
    line(locale, 'cardId', { id: entry.id }),
    line(locale, 'selfExpiry', { time: formatExpiry(entry.expiresAt, locale) }),
    line(locale, 'cardApprove', { command: commands.approve }),
    line(locale, 'selfReject', { command: commands.deny }),
    commands.hint,
    line(locale, 'selfFooter'),
  ]);
}

function diffExcerptLines(args: Partial<SelfChangeApprovalArgs>, locale: Locale | undefined): CardLine[] {
  const excerpt = Array.isArray(args.diffExcerpt)
    ? args.diffExcerpt.filter((line): line is string => typeof line === 'string')
    : null;
  const warning = t(locale, 'blindWarning');
  if (!excerpt) {
    return [t(locale, 'diffUnavailable'), warning];
  }
  if (excerpt.length === 0) {
    return [t(locale, 'diffEmpty'), warning];
  }
  const kept: string[] = [];
  let bytes = 0;
  for (const line of excerpt) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + (kept.length > 0 ? 1 : 0);
    // Re-checked here because restored cards come from stored args.
    if (kept.length >= MAX_IM_DIFF_EXCERPT_LINES || bytes + lineBytes > MAX_IM_DIFF_EXCERPT_BYTES) break;
    kept.push(line);
    bytes += lineBytes;
  }
  const truncated = args.diffExcerptTruncated === true || kept.length < excerpt.length;
  // Each excerpt line is quoted (`│ ` is framework text) and literal: `${…}` in a diff stays as written.
  return [
    t(locale, 'diffHeader'),
    ...kept.map(text => cardLine(values => `│ ${values.text}`, { text: cardLiteral(text) })),
    t(locale, truncated ? 'diffTruncated' : 'diffComplete'),
    warning,
  ];
}

function trialLine(args: Partial<SelfChangeApprovalArgs>, locale: Locale | undefined): CardLine {
  const verdict = cardLiteral(args.trial === undefined ? '-' : String(args.trial).replace(/^passed/u, t(locale, 'trialPassed')));
  const skipped = Array.isArray(args.skippedChecks)
    ? args.skippedChecks.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : [];
  if (skipped.length === 0) return line(locale, 'selfTrial', { verdict });
  const omitted = typeof args.skippedChecksOmitted === 'number' && args.skippedChecksOmitted > 0 ? args.skippedChecksOmitted : 0;
  const more = omitted > 0 ? t(locale, 'selfTrialMore', { count: omitted }) : '';
  return line(locale, 'selfTrialSkipped', { verdict, names: cardLiteral(formatList(locale, skipped, { separator: 'comma' })), more });
}

function impactLabel(impact: unknown, locale: Locale | undefined): string {
  const text = typeof impact === 'string' ? impact : 'unknown';
  const estimated = text.endsWith('(estimated)') ? t(locale, 'impactEstimated') : '';
  if (text.startsWith('none')) return `${t(locale, 'impactNone')}${estimated}`;
  if (text.startsWith('generation')) return `${t(locale, 'impactGeneration')}${estimated}`;
  if (text.startsWith('process')) return `${t(locale, 'impactProcess')}${estimated}`;
  return t(locale, 'impactUnknown');
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

function statusLabel(status: ToolApprovalEntry['status'], locale: Locale | undefined): string {
  switch (status) {
    case 'approved':
      return t(locale, 'statusApproved');
    case 'consumed':
      return t(locale, 'statusConsumed');
    case 'denied':
      return t(locale, 'statusDenied');
    case 'expired':
      return t(locale, 'statusExpired');
    default:
      return t(locale, 'statusOther');
  }
}

function formatExpiry(expiresAt: number, locale: Locale | undefined): string {
  return formatDateTime(expiresAt, locale);
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
