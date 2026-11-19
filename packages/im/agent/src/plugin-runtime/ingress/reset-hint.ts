import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { reportInboundOutcome, type Message } from '@zhin.js/core/runtime';
import { managementCommandReference } from '../../init/command-presentation.js';
import { sessionKeyLedgerId, type SessionToldLedger } from '../../memory/told-ledger.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../session/context-provenance.js';
import { deliveryOutcomeFromReceipt } from './request.js';

type ReplyReceipt = Awaited<ReturnType<Message['$reply']>>;

/**
 * #1250 `own-unhandled-message-counts-as-background`: slash spellings people use to reset a chat
 * (`/clear`, `/reset`, `/new`; any letter case, ASCII or full-width slash) that no command handled
 * and the AI trigger skipped (a leading `/` is an ignored trigger prefix). Without an answer such a
 * message would sit silently in the conversation background.
 */
const RESET_SPELLINGS = new Set(['clear', 'reset', 'new']);

export const resetHintMessages = createMessages({
  hint: {
    'zh-CN': '没有 {input} 这个指令。要清空本会话的 AI 上下文，请直接发送“清空”（或 clear、重置）{where}。',
    en: 'There is no {input} command. To clear the AI context of this conversation, send “clear” (or 清空, 重置){where}.',
  },
  whereGroup: { 'zh-CN': '，群聊里需要 @ 我', en: ' and mention me in a group' },
  operator: {
    'zh-CN': '主人或受信任用户也可以发送 {command} 归档当前会话。',
    en: 'The owner or a trusted user can also send {command} to archive this session.',
  },
});

/** The leading mentions of a group message (same shape the command suggestion strips). */
function withoutLeadingMentions(text: string): string {
  return text
    .replace(/^(?:\s*(?:\[CQ:(?:at|mention),[^[\]]*\]|<@!?[^<>\s]+>|\[(?:at|mention):[^[\]]*\]|@\S+))+\s*/iu, '')
    .trim();
}

/**
 * The normalized reset spelling (`/clear`) when `message` is one, in a private chat or addressed to
 * the bot with a mention; `undefined` otherwise. Only fixed spellings match, so the reply never echoes
 * the sender's text.
 */
export function matchResetSpelling(message: Pick<Message, 'content' | 'conversation' | 'mentioned'>): string | undefined {
  const isPrivate = message.conversation.kind === 'private';
  if (!isPrivate && message.mentioned !== true) return undefined;
  const text = (isPrivate ? message.content.trim() : withoutLeadingMentions(message.content)).normalize('NFKC');
  const match = /^\/\s*([a-z]+)$/iu.exec(text);
  const name = match?.[1]?.toLowerCase();
  return name && RESET_SPELLINGS.has(name) ? `/${name}` : undefined;
}

/** Runtime-authored, fixed-template answer naming the actual reset ways. */
export function resetHintText(input: Readonly<{
  spelling: string;
  locale?: Locale;
  isPrivate: boolean;
  isOperator: boolean;
  commandPrefix?: string;
}>): string {
  const where = input.isPrivate ? '' : resetHintMessages(input.locale, 'whereGroup');
  const lines = [resetHintMessages(input.locale, 'hint', { input: input.spelling, where })];
  const command = managementCommandReference('reset', input.commandPrefix);
  if (input.isOperator && command && command !== input.spelling) {
    lines.push(resetHintMessages(input.locale, 'operator', { command }));
  }
  return lines.join('\n');
}

/**
 * #1250 (ADR 0067 D8): sends a fixed, runtime-authored reply (no model output, no stored or
 * third-party text) through the message's reply chain and records it as this session's own delivery,
 * like a clean turn's reply (D7), so the next turn does not count it as background. Only exact
 * plain-text evidence (the receipt's digest of this very text) records it; a rewritten or rich delivery
 * keeps counting.
 */
export async function sendFixedReply(input: Readonly<{
  reply: (text: string) => Promise<ReplyReceipt>;
  toldLedger: Pick<SessionToldLedger, 'recordDelivered'> | undefined;
  sessionKey: string;
  text: string;
}>): Promise<ReplyReceipt> {
  const receipt = await input.reply(input.text);
  const outcome = deliveryOutcomeFromReceipt(receipt, input.text);
  if (outcome.status === 'sent' && outcome.messageContexts?.length) {
    input.toldLedger?.recordDelivered(sessionKeyLedgerId(input.sessionKey), outcome.messageContexts
      .map(item => deliveredMessageContextRef(item.message, deliveredTextDigest(item.plannedText))));
  }
  return receipt;
}

/** #1250: one reset hint per conversation and sender within this window (milliseconds). */
export const RESET_HINT_COOLDOWN_MS = 60_000;
const RESET_HINT_COOLDOWN_MAX_ENTRIES = 2_000;

/**
 * #1250: remembers when a reset hint was last sent to a sender in a conversation, so repeating
 * `/clear` cannot make the bot answer every message (process memory, bounded).
 */
export class ResetHintCooldown {
  readonly #sent = new Map<string, number>();

  constructor(private readonly windowMs = RESET_HINT_COOLDOWN_MS, private readonly now: () => number = Date.now) {}

  /** `true` (and starts the window) when no hint went to this key within the window. */
  take(key: string): boolean {
    const now = this.now();
    const last = this.#sent.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.#sent.delete(key);
    this.#sent.set(key, now);
    while (this.#sent.size > RESET_HINT_COOLDOWN_MAX_ENTRIES) {
      const oldest = this.#sent.keys().next().value;
      if (oldest === undefined) break;
      this.#sent.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.#sent.clear();
  }
}

/** The trigger and access settings a reset hint must respect (subset of the Agent config). */
export interface ResetHintPolicy {
  readonly trigger?: Readonly<{ enabled?: boolean; respondToAt?: boolean; respondToPrivate?: boolean }>;
  readonly access?: Readonly<{ mode?: string; users?: readonly string[]; groups?: readonly string[] }>;
}

/**
 * #1250: the hint is only sent where the AI would have answered a normal message from this sender:
 * the trigger is on, private chats (or mentions in a group) are answered, and the AI access gate is
 * open for this sender / group. Anything else stays silent (fail closed).
 */
export function resetHintAllowed(message: Pick<Message, 'conversation' | 'mentioned' | 'sender'>, policy: ResetHintPolicy): boolean {
  const { trigger, access } = policy;
  if (trigger?.enabled === false) return false;
  const isPrivate = message.conversation.kind === 'private';
  if (isPrivate ? trigger?.respondToPrivate === false : (message.mentioned !== true || trigger?.respondToAt === false)) return false;
  const mode = access?.mode ?? 'open';
  if (mode === 'open') return true;
  if (mode !== 'whitelist') return false;
  const senderId = message.sender?.id?.trim();
  if (senderId && access?.users?.includes(senderId)) return true;
  return !isPrivate && (access?.groups?.includes(message.conversation.id) ?? false);
}

/**
 * Answers an unhandled reset spelling (see {@link matchResetSpelling}); `true` when it did. Called by
 * the ingress only after the control-plane, speaking and trigger gates passed and no trigger matched
 * the message: a triggered `clear` is the real clear command. At most one hint per conversation and
 * sender within the cooldown; inside it the message falls through unanswered, as before.
 */
export async function answerResetSpelling(input: Readonly<{
  message: Message;
  policy: ResetHintPolicy;
  cooldown: ResetHintCooldown;
  cooldownKey: string;
  isOperator: boolean;
  /** The control plane stopped outbound messages here: no hint (the message falls through). */
  outboundBlocked?: () => boolean;
  send: (text: string) => Promise<unknown>;
}>): Promise<boolean> {
  const spelling = matchResetSpelling(input.message);
  if (!spelling || !resetHintAllowed(input.message, input.policy)) return false;
  if (input.outboundBlocked?.()) return false;
  // Within the cooldown the message is handled as before the hint existed (no reply).
  if (!input.cooldown.take(input.cooldownKey)) return false;
  reportInboundOutcome(input.message, { outcome: 'suggested', reason: 'reset_hint', stage: 'agent_gate' });
  await input.send(resetHintText({
    spelling,
    locale: input.message.locale,
    isPrivate: input.message.conversation.kind === 'private',
    isOperator: input.isOperator,
    ...(input.message.commandPrefix !== undefined ? { commandPrefix: input.message.commandPrefix } : {}),
  }));
  return true;
}
