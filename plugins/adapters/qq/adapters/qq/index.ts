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
          supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'markdown', 'keyboard', 'card', 'share'],
          markdown: 'native',
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
          model: {
            share: {
              fields: ['description', 'image'],
              scopes: ['private', 'group'],
              hint: 'QQ 群聊和单聊把 title、description、url、image 都填写完整的 share 发成图文卡片（msg_type=8，type=tuwen）。url 和 image 必须是 https；title 1-50 个字符，description 1-200 个字符。缺任一字段或带音频/音乐平台时不会发送。频道不支持。',
            },
          },
        },
        mention: { user: true },
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
      messaging: { mention: { all: true } },
      prompt: {
        text: '群聊 @全体成员使用 mention target "all"（发送为 <qqbot-at-everyone />）。机器人必须是该群管理员，且每个群每个自然日只能发送 1 次。图文卡片只用于群聊和单聊。',
      },
      delivery: { passiveWindow: { seconds: 300, maxMessages: 5 } },
    },
    channel: {
      messaging: { mention: { all: true } },
      prompt: {
        text: '文字子频道 @全体成员使用 mention target "all"（发送为 <qqbot-at-everyone />），机器人需要拥有发送 @全体成员的权限。图文卡片不能发到频道。',
      },
      delivery: { passiveWindow: { seconds: 300, maxMessages: 5 } },
    },
  },
  createAdapter: context => new QqAdapter(context),
});
