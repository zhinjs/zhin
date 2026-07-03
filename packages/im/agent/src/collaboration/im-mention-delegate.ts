/**
 * 向 peer Endpoint 发送真实 IM @ 消息段（统一发送链）。
 */
import type { Message } from '@zhin.js/core';
import { sendGroupMessageFromEndpoint } from './group-message.js';

export interface GroupPeerMentionInput {
  message: Message;
  targetEndpointId: string;
  text: string;
}

/** 发送带 platform @ segment 的群消息，触发 peer bot 入站。 */
export async function sendGroupPeerMention(
  input: GroupPeerMentionInput,
): Promise<{ ok: boolean; error?: string }> {
  const { message, targetEndpointId, text } = input;
  return sendGroupMessageFromEndpoint({
    message,
    text,
    atTargetEndpointId: targetEndpointId,
  });
}

/** @deprecated 使用 sendGroupPeerMention */
export async function sendImMentionDelegation(
  input: GroupPeerMentionInput & { cell?: unknown },
): Promise<{ ok: boolean; error?: string }> {
  return sendGroupPeerMention(input);
}
