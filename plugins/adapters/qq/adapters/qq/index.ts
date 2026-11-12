/**
 * Convention entry: discover `adapters/qq/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { QqAdapter } from '../../src/adapter.js';
import {
  type QqEndpointConfig,
} from '../../src/protocol.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
} from '../../src/endpoint.js';
export type {
  QqBotTransport,
  QqEndpointOptions,
  QqHttpBotTransport,
  QqHttpEndpointOptions,
} from '../../src/endpoint.js';

export default defineAdapter<QqEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall', 'reaction'],
  // 媒体 url 直发，base64/path 由 SDK formatMediaData 物化走 /files 上传；
  // markdown/keyboard 原生按钮承载交互段。
  profile: {
    default: {
      messaging: {
        segments: {
          supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'markdown', 'keyboard'],
          markdown: 'native',
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
        },
        quote: true,
        recall: {},
      },
      actions: {
        recall: { scopes: ['private', 'group', 'channel'] },
        quoteReply: { scopes: ['private', 'group', 'channel'] },
      },
      delivery: { send: true, requiresMessageSeq: true, spool: true },
    },
    private: {
      delivery: { passiveWindow: { seconds: 3600, maxMessages: 4 } },
    },
    group: {
      delivery: { passiveWindow: { seconds: 300, maxMessages: 5 } },
      // ADR 0056 §1：机器人自身群内角色（getBotState.member_role），供 bot:* permit。
      scene: { selfStanding: { standing: true } },
    },
    channel: {
      delivery: { passiveWindow: { seconds: 300, maxMessages: 5 } },
      // ADR 0056 §1：频道消息的 member.roles → standing（频道主 / 超级管理员）+ 原始身份组 roles。
      scene: { platformStanding: { standing: true, roles: true }, selfStanding: { standing: true, roles: true } },
    },
  },
  createAdapter: context => new QqAdapter(context),
});
