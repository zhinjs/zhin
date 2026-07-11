import type { SlackMessageEvent } from './types.js';

const DEDUPE_TTL_MS = 60_000;

export interface SlackInboundFilterState {
  seenInbound: Map<string, number>;
}

export function createSlackInboundFilterState(): SlackInboundFilterState {
  return { seenInbound: new Map() };
}

function pruneSeen(state: SlackInboundFilterState, now: number): void {
  if (state.seenInbound.size < 512) return;
  for (const [key, at] of state.seenInbound) {
    if (now - at > DEDUPE_TTL_MS) {
      state.seenInbound.delete(key);
    }
  }
}

/**
 * 过滤不应进入 IM 管道的 Slack 入站消息。
 * - 跳过 Bot 自身消息
 * - 频道内 @Bot：只保留 app_mention，丢弃重复的 message 事件
 * - channel:ts 去重（message + app_mention 等同一条）
 */
export function shouldDropSlackInboundMessage(
  event: SlackMessageEvent,
  state: SlackInboundFilterState,
  botUserId?: string,
): boolean {
  if (event.subtype === 'bot_message' || event.subtype === 'message_changed') {
    return true;
  }

  if (event.bot_id) return true;
  if (botUserId && event.user === botUserId) return true;

  const channelType = event.channel_type ?? 'channel';
  const text = event.text ?? '';

  if (event.type === 'message' && channelType !== 'im' && botUserId) {
    if (text.includes(`<@${botUserId}>`)) {
      return true;
    }
  }

  if (!event.channel || !event.ts) return true;

  const key = `${event.channel}:${event.ts}`;
  const now = Date.now();
  const seenAt = state.seenInbound.get(key);
  if (seenAt != null && now - seenAt < DEDUPE_TTL_MS) {
    return true;
  }
  state.seenInbound.set(key, now);
  pruneSeen(state, now);
  return false;
}
