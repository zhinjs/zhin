import { projectLocaleToken } from 'zhin.js/i18n';
/**
 * Convention entry: discover `adapters/icqq/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { IcqqEndpoint } from '../../src/endpoint.js';
import { icqqRuntimeStateToken } from '../../src/icqq-runtime-state.js';
import {
  resolveIcqqConfig,
  type IcqqEndpointConfig,
} from '../../src/protocol.js';

export { IcqqEndpoint } from '../../src/endpoint.js';
export type { IcqqEndpointOptions } from '../../src/endpoint.js';

declare module '@zhin.js/core' {
  interface AdapterEndpoints {
    icqq: import('../../src/endpoint.js').IcqqEndpoint;
  }
}

/** Group reactions take QQ system face ids. Private chats have none. */
const ICQQ_REACTIONS = [
  { value: '76', label: '赞' }, { value: '66', label: '爱心' }, { value: '124', label: 'OK' },
  { value: '99', label: '鼓掌' }, { value: '144', label: '喝彩' }, { value: '320', label: '庆祝' },
  { value: '319', label: '比心' }, { value: '299', label: '牛啊' }, { value: '297', label: '拜谢' },
  { value: '182', label: '笑哭' }, { value: '179', label: 'doge' }, { value: '264', label: '捂脸' },
  { value: '271', label: '吃瓜' }, { value: '269', label: '暗中观察' }, { value: '268', label: '问号脸' },
  { value: '270', label: 'emm' }, { value: '106', label: '委屈' }, { value: '285', label: '摸鱼' },
  { value: '104', label: '哈欠' }, { value: '267', label: '头秃' }, { value: '326', label: '生气' },
];

/** QQ group mute: 1 minute to 30 days (0 lifts it, which is the `unmute` action). */
const ICQQ_MUTE_SECONDS = { min: 60, max: 2592000 } as const;

export default defineAdapter<IcqqEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  profile: {
    default: {
      messaging: {
        segments: {
          // Canonical types formatOutboundBody encodes; markdown / keyboard degrade to text first.
          supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face', 'dice', 'rps', 'share'],
          outboundMedia: ['base64', 'url', 'path'],
          interactive: 'text',
          reaction: { scopes: ['group'], values: ICQQ_REACTIONS },
          model: {
            share: {
              fields: ['description', 'image', 'audio', 'platform'],
              hint: 'renders as a QQ link card. For a song, set audio to the playable link, image to the cover, description to the artist and platform to its music service (qq, netease, kugou, kuwo or migu), copied from tool results; leave a field "" when you have no real value.',
            },
          },
        },
        mention: { user: true },
        quote: true,
        recall: { timeLimitSeconds: 120 },
        forward: {},
      },
      scene: { roles: { owner: 'owner', admin: 'admin', member: 'member' } },
      actions: {
        recall: { scopes: ['private', 'group'], params: { timeLimitSeconds: 120 } },
        quoteReply: { scopes: ['private', 'group'] },
        forward: { scopes: ['private', 'group'] },
        poke: { scopes: ['private', 'group'] },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
    private: {
      // A private chat has no reactions, so feedback is a short status message.
      feedback: { mode: 'status-message', text: '⏳' },
      events: { emit: ['message.recalled', 'poke'] },
    },
    group: {
      messaging: { reaction: { emojis: ICQQ_REACTIONS.map((item) => item.value) } },
      scene: {
        groupInfo: true,
        memberProfile: true,
        card: true,
        title: true,
        mute: { durationSeconds: ICQQ_MUTE_SECONDS, all: true },
      },
      actions: {
        reaction: { scopes: ['group'], params: { emojis: ICQQ_REACTIONS.map((item) => item.value), own: true, others: true, cancellable: true } },
        mute: { scopes: ['group'], requiresRole: 'admin', params: { durationSeconds: ICQQ_MUTE_SECONDS } },
        unmute: { scopes: ['group'], requiresRole: 'admin' },
        muteAll: { scopes: ['group'], requiresRole: 'admin' },
        kick: { scopes: ['group'], requiresRole: 'admin' },
        setCard: { scopes: ['group'], requiresRole: 'admin' },
        setTitle: { scopes: ['group'], requiresRole: 'owner' },
        essence: { scopes: ['group'], requiresRole: 'admin' },
        announce: { scopes: ['group'], requiresRole: 'admin' },
        invite: { scopes: ['group'] },
      },
      events: {
        emit: ['member.joined', 'member.left', 'member.role_changed', 'member.muted', 'message.recalled', 'poke'],
      },
      feedback: { mode: 'reaction', emoji: '⏳' },
      prompt: {
        text: '被禁言或不是管理员时不要尝试管理类操作；头衔只有群主能设；邀请只能邀请你的好友。',
      },
    },
    channel: {
      // Guild channels: text and media in and out; no recall, poke, forward, reaction or management actions.
      actions: {
        recall: false,
        poke: false,
        forward: false,
      },
      feedback: { mode: 'none' },
    },
  },
  create(context) {
    const config = resolveIcqqConfig(context.config);
    // 注册到插件运行时状态（icqq endpoint list 的"运行中"数据源）
    context.use(icqqRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'direct',
    });
    return new IcqqEndpoint({
      id: context.id,
      loginAssist: context.use(loginAssistToken),
      locale: context.use(projectLocaleToken),
      config,
    });
  },
});
