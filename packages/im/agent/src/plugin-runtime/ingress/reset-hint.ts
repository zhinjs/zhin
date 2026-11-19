import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { reportInboundOutcome, type Message } from '@zhin.js/core/runtime';
import { managementCommandReference } from '../../init/command-presentation.js';
import type { SessionToldLedger } from '../../memory/told-ledger.js';
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
    input.toldLedger?.recordDelivered(input.sessionKey, outcome.messageContexts
      .map(item => deliveredMessageContextRef(item.message, deliveredTextDigest(item.plannedText))));
  }
  return receipt;
}

/**
 * Answers an unhandled reset spelling (see {@link matchResetSpelling}); `true` when it did. The AI
 * trigger must not have taken the message (`triggered`): a triggered `clear` is the real clear command.
 */
export async function answerResetSpelling(input: Readonly<{
  message: Message;
  triggered: boolean;
  isOperator: boolean;
  send: (text: string) => Promise<unknown>;
}>): Promise<boolean> {
  const spelling = input.triggered ? undefined : matchResetSpelling(input.message);
  if (!spelling) return false;
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
