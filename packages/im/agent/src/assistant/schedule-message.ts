import type { Message, SendContent } from '@zhin.js/core';
import { createSyntheticMessage, type AgentTurnMessage } from '@zhin.js/core';

export interface BuildScheduleTurnMessageInput {
  sourceMessage: Message;
  /** 仅用于 synthetic 载体，不写入 sourceMessage */
  extra?: Record<string, unknown>;
}

/** 构建调度 turn 用 synthetic Message，不 mutate 入站 Message */
export function buildScheduleTurnMessage(input: BuildScheduleTurnMessageInput): AgentTurnMessage {
  const { sourceMessage, extra } = input;
  const channel = sourceMessage.$channel ?? {
    type: 'private' as const,
    id: sourceMessage.$sender.id,
  };
  const reply = typeof sourceMessage.$reply === 'function'
    ? sourceMessage.$reply.bind(sourceMessage)
    : undefined;

  return createSyntheticMessage({
    adapter: String(sourceMessage.$adapter),
    endpoint: sourceMessage.$endpoint,
    sender: { ...sourceMessage.$sender },
    channel,
    id: sourceMessage.$id,
    quote_id: sourceMessage.$quote_id,
    reply: reply as ((content: SendContent, quote?: boolean | string) => Promise<string>) | undefined,
    extra: extra && Object.keys(extra).length > 0 ? extra : undefined,
  });
}
