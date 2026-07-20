import { getActionFromMessage, resolvePayloadFromText, type Message } from '@zhin.js/core';

import { channelKey } from './board-sender.js';
import { parseChoicePayload } from './choice-keyboard.js';

export const GAME_RESTART_CHOICE_IDS = new Set([
  'restart',
  'restart_char',
  'restart_idiom',
  'restart_bot',
]);

export function isRestartChoice(choiceId: string): boolean {
  return GAME_RESTART_CHOICE_IDS.has(choiceId) || choiceId.startsWith('restart_');
}

/** 从 QQ 指令预填 / 数字 fallback 解析游戏 payload */
export function resolveGameTextPayload(
  raw: string,
  map?: Record<string, string>,
): string | undefined {
  return resolvePayloadFromText(raw, map);
}

export interface GameSessionRef {
  id: string;
  channel_key: string;
}

export interface ResolveGameChoiceOptions {
  message: Message<any>;
  gamePrefix: string;
  validChoiceIds: readonly string[];
  getById: (sessionId: string) => Promise<GameSessionRef | null>;
  getActiveForUser: (channel: string, userId: string) => Promise<GameSessionRef | null>;
  getByBoardMessageId?: (messageId: string) => Promise<GameSessionRef | null>;
}

/**
 * 解析按钮/选项回调：优先 payload；终局「再来一局」允许已结束 session。
 */
export async function resolveGameChoice(
  opts: ResolveGameChoiceOptions,
): Promise<{ sessionId: string; choiceId: string } | null> {
  const action = getActionFromMessage(opts.message);
  if (!action) return null;

  const ch = channelKey(opts.message);
  const userId = opts.message.$sender.id;

  const fromPayload = parseChoicePayload(action.payload, opts.gamePrefix);
  if (fromPayload && opts.validChoiceIds.includes(fromPayload.choiceId)) {
    const session = await opts.getById(fromPayload.sessionId);
    if (session?.channel_key === ch) {
      return { sessionId: fromPayload.sessionId, choiceId: fromPayload.choiceId };
    }
  }

  const choiceId = action.id || action.payload;
  if (!choiceId || !opts.validChoiceIds.includes(choiceId)) return null;

  if (isRestartChoice(choiceId)) {
    if (fromPayload) {
      const session = await opts.getById(fromPayload.sessionId);
      if (session?.channel_key === ch) {
        return { sessionId: fromPayload.sessionId, choiceId };
      }
    }
    if (action.sourceMessageId && opts.getByBoardMessageId) {
      const byBoard = await opts.getByBoardMessageId(action.sourceMessageId);
      if (byBoard && byBoard.channel_key === ch) {
        return { sessionId: byBoard.id, choiceId };
      }
    }
    const active = await opts.getActiveForUser(ch, userId);
    if (active) return { sessionId: active.id, choiceId };
    return null;
  }

  const session =
    (await opts.getActiveForUser(ch, userId))
    ?? (action.sourceMessageId && opts.getByBoardMessageId
      ? await opts.getByBoardMessageId(action.sourceMessageId)
      : null);
  if (!session || session.channel_key !== ch) return null;

  return { sessionId: session.id, choiceId };
}
