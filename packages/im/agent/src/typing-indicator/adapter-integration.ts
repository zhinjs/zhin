/**
 * Activity Feedback 平台能力与出站格式辅助（原 Typing Indicator 集成层已移除）。
 */

import type { Endpoint, SendContent } from '@zhin.js/core';
import type { TypingIndicatorOptions } from './index.js';

interface MessageEditableBot {
  $editMessage?(messageId: string, content: string): Promise<void>;
  $updateMessage?(messageId: string, content: string): Promise<void>;
}

export type BotWithEditing = Endpoint & Partial<MessageEditableBot>;

/** QQ 群聊禁止无引用的主动消息（40034105），需 reply 触发消息 */
export function buildTypingSendContent(
  platform: string,
  options: TypingIndicatorOptions,
  text: string,
): SendContent | null {
  if (platform === 'qq' && options.sceneType === 'group') {
    if (!options.messageId) return null;
    return [
      { type: 'reply', data: { id: options.messageId } },
      { type: 'text', data: { text } },
    ];
  }
  return [{ type: 'text', data: { text } }];
}

export interface PlatformFeatures {
  platform: string;
  supportsReaction: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
  supportsTyping: boolean;
  defaultType: 'reaction' | 'message' | 'typing' | 'none';
}

export const PLATFORM_FEATURES: Record<string, PlatformFeatures> = {
  icqq: {
    platform: 'icqq',
    supportsReaction: true,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'reaction',
  },
  telegram: {
    platform: 'telegram',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  discord: {
    platform: 'discord',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  kook: {
    platform: 'kook',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'reaction',
  },
  'weixin-ilink': {
    platform: 'weixin-ilink',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: true,
    defaultType: 'typing',
  },
  slack: {
    platform: 'slack',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'reaction',
  },
  lark: {
    platform: 'lark',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  dingtalk: {
    platform: 'dingtalk',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'message',
  },
  qq: {
    platform: 'qq',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  onebot11: {
    platform: 'onebot11',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  onebot12: {
    platform: 'onebot12',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  napcat: {
    platform: 'napcat',
    supportsReaction: true,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'reaction',
  },
  github: {
    platform: 'github',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'message',
  },
  satori: {
    platform: 'satori',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  email: {
    platform: 'email',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'none',
  },
  'wechat-mp': {
    platform: 'wechat-mp',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'none',
  },
  milky: {
    platform: 'milky',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  sandbox: {
    platform: 'sandbox',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
};
