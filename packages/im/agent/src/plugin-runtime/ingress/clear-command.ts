import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { reportInboundOutcome, type Message } from '@zhin.js/core/runtime';
import { sessionKeyLedgerId, type SessionToldLedger } from '../../memory/told-ledger.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../session/context-provenance.js';
import { isClearCommand } from './content.js';
import { deliveryOutcomeFromReceipt } from './request.js';

type ReplyReceipt = Awaited<ReturnType<Message['$reply']>>;

/**
 * #1250: the chat clear command. `clear` / 清空 / 重置 (as triggered AI input) and the slash spellings
 * `/clear`, `/reset`, `/new` (any letter case, ASCII or full-width slash; see {@link isClearCommand})
 * archive the sender's session context through `ZhinAgent.archiveSession` — the one reset path, also
 * used by the operator `<prefix>reset` management command — and answer with a short fixed confirmation.
 */
export const clearCommandMessages = createMessages({
  cleared: {
    'zh-CN': '已清空本会话的 AI 多轮上下文。长期记忆和定时任务不受影响。',
    en: 'Cleared the AI conversation context for this session. Long-term memory and scheduled tasks are not affected.',
  },
});

/** The fixed confirmation sent after a clear. */
export function clearedText(locale: Locale | undefined): string {
  return clearCommandMessages(locale, 'cleared');
}

/** The leading mentions of a group message (same shape the command suggestion strips). */
function withoutLeadingMentions(text: string): string {
  return text
    .replace(/^(?:\s*(?:\[CQ:(?:at|mention),[^[\]]*\]|<@!?[^<>\s]+>|\[(?:at|mention):[^[\]]*\]|@\S+))+\s*/iu, '')
    .trim();
}

/**
 * `true` when `message` is a clear command (see {@link isClearCommand}) sent in a private chat, or
 * addressed to the bot with a mention in a group. Used for messages no AI trigger matched (a leading
 * `/` is an ignored trigger prefix), so `/clear` reaches the same clear as a triggered `清空`.
 */
export function matchClearCommand(message: Pick<Message, 'content' | 'conversation' | 'mentioned'>): boolean {
  const isPrivate = message.conversation.kind === 'private';
  if (!isPrivate && message.mentioned !== true) return false;
  return isClearCommand(isPrivate ? message.content : withoutLeadingMentions(message.content));
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

/** #1250: one "nothing more to clear" confirmation per conversation and sender within this window (ms). */
export const CLEAR_CONFIRM_COOLDOWN_MS = 60_000;
const CLEAR_CONFIRM_COOLDOWN_MAX_ENTRIES = 2_000;

/**
 * #1250: remembers when a clear was last confirmed to a sender in a conversation, so repeating
 * `/clear` cannot make the bot answer every message (process memory, bounded).
 */
export class ClearConfirmCooldown {
  readonly #sent = new Map<string, number>();

  constructor(private readonly windowMs = CLEAR_CONFIRM_COOLDOWN_MS, private readonly now: () => number = Date.now) {}

  /** `true` (and starts the window) when no confirmation went to this key within the window. */
  take(key: string): boolean {
    const now = this.now();
    const last = this.#sent.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.#sent.delete(key);
    this.#sent.set(key, now);
    while (this.#sent.size > CLEAR_CONFIRM_COOLDOWN_MAX_ENTRIES) {
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

/** The trigger and access settings an untriggered clear command must respect (subset of the Agent config). */
export interface ClearCommandPolicy {
  readonly trigger?: Readonly<{ enabled?: boolean; respondToAt?: boolean; respondToPrivate?: boolean }>;
  readonly access?: Readonly<{ mode?: string; users?: readonly string[]; groups?: readonly string[] }>;
}

/**
 * #1250: an untriggered clear command only acts where the AI would have answered a normal message
 * from this sender: the trigger is on, private chats (or mentions in a group) are answered, and the AI
 * access gate is open for this sender / group. Anything else stays silent (fail closed).
 */
export function clearCommandAllowed(message: Pick<Message, 'conversation' | 'mentioned' | 'sender'>, policy: ClearCommandPolicy): boolean {
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
 * Archives the session context (`archive` is `ZhinAgent.archiveSession` for the sender's session key),
 * reports the `cleared` outcome and confirms. Clearing is idempotent; the confirmation is sent when
 * something was archived, or else at most once per cooldown window, so a repeated `/clear` does not
 * flood the conversation.
 */
export async function clearSessionContext(input: Readonly<{
  message: Message;
  archive: () => Promise<boolean>;
  cooldown: ClearConfirmCooldown;
  cooldownKey: string;
  send: (text: string) => Promise<unknown>;
  turnId?: string;
}>): Promise<void> {
  const archived = await input.archive();
  const fresh = input.cooldown.take(input.cooldownKey);
  reportInboundOutcome(input.message, {
    outcome: 'cleared', reason: 'clear_command', stage: 'agent_gate',
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  });
  if (archived || fresh) await input.send(clearedText(input.message.locale));
}

/**
 * Handles a clear command no trigger matched (see {@link matchClearCommand}); `true` when it did.
 * Called by the ingress only after the control-plane, speaking and trigger gates passed and no command
 * handled the message. Nothing happens (the message falls through as before) when the AI would not
 * answer this sender here or the control plane stopped outbound messages.
 */
export async function answerClearCommand(input: Readonly<{
  message: Message;
  policy: ClearCommandPolicy;
  /** The control plane stopped outbound messages here: no clear, no reply (the message falls through). */
  outboundBlocked?: () => boolean;
  archive: () => Promise<boolean>;
  cooldown: ClearConfirmCooldown;
  cooldownKey: string;
  send: (text: string) => Promise<unknown>;
}>): Promise<boolean> {
  if (!matchClearCommand(input.message) || !clearCommandAllowed(input.message, input.policy)) return false;
  if (input.outboundBlocked?.()) return false;
  await clearSessionContext(input);
  return true;
}
