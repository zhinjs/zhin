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
 * archive the sender's session context through `ZhinAgent.archiveSession` and answer with a short
 * fixed confirmation. Everyone can use it.
 *
 * With the command prefix `/`, `/reset` is the Agent's Root `reset` command (#1250 第 83 批), which the
 * command dispatch claims before this ingress sees the message: for a sender without a zhin chat role
 * that command runs exactly this clear (`AgentTurnIngressRoute.clearAsCommand`, the same triggers,
 * mention requirement, cooldown and gates); a trusted sender's `reset` archives the session directly.
 */
export const CLEARED_MESSAGE = Object.freeze({
  'zh-CN': '已清空本会话的 AI 多轮上下文。长期记忆和定时任务不受影响。',
  en: 'Cleared the AI conversation context for this session. Long-term memory and scheduled tasks are not affected.',
});

export const clearCommandMessages = createMessages({ cleared: CLEARED_MESSAGE });

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
 * `true` when the message addressed the bot by mention — the same test the AI trigger applies
 * (`message.mentioned`, or `metadata.mentioned` from adapters that report mentions there).
 */
function mentionedBot(message: Pick<Message, 'mentioned' | 'metadata'>): boolean {
  return message.mentioned === true || message.metadata?.mentioned === true;
}

/** The bot's own account handle, when the adapter reports it (`metadata.botUsername`, e.g. Telegram). */
function botUsernameOf(message: Pick<Message, 'metadata'>): string | undefined {
  const value = message.metadata?.botUsername;
  if (typeof value !== 'string') return undefined;
  const handle = value.trim().replace(/^@/u, '').toLowerCase();
  return handle || undefined;
}

type CommandText = Readonly<{ text: string; addressed: boolean }>;

/**
 * Resolves a Telegram-style `/clear@<bot>` suffix: with the bot's own handle (case-insensitive) the
 * suffix is dropped and the command counts as addressed to the bot; a suffix naming another account,
 * or any suffix when the handle is unknown, never matches (`undefined`). Text without a suffix is
 * returned trimmed.
 */
function withoutOwnCommandSuffix(text: string, botUsername: string | undefined): CommandText | undefined {
  const trimmed = text.normalize('NFKC').trim();
  const suffixed = /^(\/\s*[a-z]+)@([a-z0-9_]+)$/iu.exec(trimmed);
  if (!suffixed) return { text: trimmed, addressed: false };
  return botUsername !== undefined && suffixed[2]!.toLowerCase() === botUsername
    ? { text: suffixed[1]!, addressed: true }
    : undefined;
}

/**
 * The clear command a message carries: `addressed` when it was sent to the bot (private, mention,
 * `/clear@<bot>`). `recognized`: the command dispatch already recognized the message as a clear (the
 * Root `reset` command, see {@link CLEARED_MESSAGE}), so only where it was sent is checked.
 */
function clearCommandOf(message: Pick<Message, 'content' | 'conversation' | 'mentioned' | 'metadata'>, recognized = false): CommandText | undefined {
  const isPrivate = message.conversation.kind === 'private';
  const mentioned = !isPrivate && mentionedBot(message);
  if (recognized) return { text: message.content.trim(), addressed: isPrivate || mentioned };
  const command = withoutOwnCommandSuffix(mentioned ? withoutLeadingMentions(message.content) : message.content, botUsernameOf(message));
  if (!command || !isClearCommand(command.text)) return undefined;
  return { text: command.text, addressed: isPrivate || mentioned || command.addressed };
}

/**
 * `true` when `message` is a clear command (see {@link isClearCommand}) sent in a private chat, or
 * addressed to the bot in a group — by mention, or as `/clear@<bot>` when the adapter reports the
 * bot's handle (`metadata.botUsername`); `/clear@<another account>` never matches. Used for messages
 * no AI trigger matched (a leading `/` is an ignored trigger prefix), so `/clear` reaches the same
 * clear as a triggered `清空`.
 */
export function matchClearCommand(message: Pick<Message, 'content' | 'conversation' | 'mentioned' | 'metadata'>, recognized = false): boolean {
  return clearCommandOf(message, recognized)?.addressed === true;
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

/** The trigger settings an untriggered clear command must respect (subset of the Agent config). */
export interface ClearCommandPolicy {
  readonly trigger?: Readonly<{ enabled?: boolean; respondToAt?: boolean; respondToPrivate?: boolean }>;
}

/**
 * #1250: an untriggered clear command only acts where the bot answers this sender: the AI trigger is
 * on and answers private chats, or mentions in a group (`/clear@<bot>` counts as one). The
 * control-plane and speaking gates already ran. `ai.access` is not consulted: no IM ingress path
 * enforces it, so it does not narrow clearing either.
 */
export function clearCommandAllowed(
  message: Pick<Message, 'content' | 'conversation' | 'mentioned' | 'metadata'>,
  policy: ClearCommandPolicy,
  recognized = false,
): boolean {
  const { trigger } = policy;
  if (trigger?.enabled === false) return false;
  if (message.conversation.kind === 'private') return trigger?.respondToPrivate !== false;
  return trigger?.respondToAt !== false && clearCommandOf(message, recognized)?.addressed === true;
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
  // The confirmation is always sent from here (callers check the outbound stop first), so taking the
  // cooldown only ever consumes it for a confirmation that goes out.
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
  /** The command dispatch already recognized `message` as a clear (the Root `reset` command). */
  recognized?: boolean;
  /** The control plane stopped outbound messages here: no clear, no reply (the message falls through). */
  outboundBlocked?: () => boolean;
  archive: () => Promise<boolean>;
  cooldown: ClearConfirmCooldown;
  cooldownKey: string;
  send: (text: string) => Promise<unknown>;
}>): Promise<boolean> {
  const recognized = input.recognized === true;
  if (!matchClearCommand(input.message, recognized) || !clearCommandAllowed(input.message, input.policy, recognized)) return false;
  if (input.outboundBlocked?.()) return false;
  await clearSessionContext(input);
  return true;
}
