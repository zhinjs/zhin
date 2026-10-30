import { IcqqAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/icqq/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type IcqqEndpointConfig,
} from '../../src/protocol.js';

export { IcqqEndpoint } from '../../src/endpoint.js';
export type { IcqqEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<IcqqEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall', 'reaction'],
  segments: {
    // Canonical types formatOutboundBody encodes; markdown / keyboard degrade to text first.
    supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face', 'dice', 'rps', 'share'],
    outboundMedia: ['base64', 'url', 'path'],
    interactive: 'text',
    // QQ group reactions take system face ids; private chats have no reactions.
    reaction: {
      scopes: ['group'],
      values: [
        { value: '76', label: '赞' }, { value: '66', label: '爱心' }, { value: '124', label: 'OK' },
        { value: '99', label: '鼓掌' }, { value: '144', label: '喝彩' }, { value: '320', label: '庆祝' },
        { value: '319', label: '比心' }, { value: '299', label: '牛啊' }, { value: '297', label: '拜谢' },
        { value: '182', label: '笑哭' }, { value: '179', label: 'doge' }, { value: '264', label: '捂脸' },
        { value: '271', label: '吃瓜' }, { value: '269', label: '暗中观察' }, { value: '268', label: '问号脸' },
        { value: '270', label: 'emm' }, { value: '106', label: '委屈' }, { value: '285', label: '摸鱼' },
        { value: '104', label: '哈欠' }, { value: '267', label: '头秃' }, { value: '326', label: '生气' },
      ],
    },
    model: {
      share: {
        fields: ['description', 'image', 'audio', 'platform'],
        hint: 'renders as a QQ link card. For a song, set audio to the playable link, image to the cover, description to the artist and platform to its music service (qq, netease, kugou, kuwo or migu), copied from tool results; leave a field "" when you have no real value.',
      },
    },
  },
  createAdapter: context => new IcqqAdapter(context),
});
