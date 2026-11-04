/**
 * Activity Feedback 平台能力与出站格式辅助。
 *
 * ADR 0044: 平台差异（用什么方式提示「正在处理」、表情、文案、刷新间隔、是否必须引用回复）由适配器的
 * `feedback` / `actions.reaction` / `delivery` 能力声明，这里只读能力，不再按平台名列表。
 */

import type { SendContent } from '@zhin.js/core';
import type { TypingIndicatorOptions } from './index.js';

/**
 * One conversation kind of an Endpoint's capability profile, as far as activity feedback needs it.
 * Structurally a subset of `EndpointKindCapabilities` (`@zhin.js/im-contract`).
 */
export interface ActivityFeedbackKindCapabilities {
  readonly feedback?: Readonly<{
    mode: 'typing' | 'reaction' | 'status-message' | 'none';
    emoji?: string;
    text?: string;
    refreshSeconds?: number;
  }>;
  /** The Bot can react to a message with an emoji in this kind of conversation. */
  readonly reaction: boolean;
  readonly edit: boolean;
  readonly recall: boolean;
  /** Messages here must quote an inbound message (`delivery.proactive === false`). */
  readonly needsReply: boolean;
}

/** Platforms that forbid unsolicited messages in a conversation need the trigger message quoted. */
export function buildTypingSendContent(
  capabilities: Pick<ActivityFeedbackKindCapabilities, 'needsReply'> | undefined,
  options: TypingIndicatorOptions,
  text: string,
): SendContent | null {
  if (capabilities?.needsReply === true) {
    if (!options.messageId) return null;
    return [
      { type: 'reply', data: { id: options.messageId } },
      { type: 'text', data: { text } },
    ];
  }
  return [{ type: 'text', data: { text } }];
}
