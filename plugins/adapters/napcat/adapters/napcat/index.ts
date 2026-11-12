/**
 * Convention entry: discover `adapters/napcat/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { NapcatAdapter } from '../../src/adapter.js';
import type { NapCatEndpointConfig } from '../../src/protocol.js';

export {
  NapCatHttpEndpoint,
  type NapCatHttpEndpointOptions,
} from '../../src/http-endpoint.js';
export {
  NapCatWsEndpoint,
  type NapCatWsEndpointOptions,
} from '../../src/ws-endpoint.js';
export {
  NapCatWssEndpoint,
  type NapCatWssEndpointOptions,
} from '../../src/wss-endpoint.js';
export type { NapCatWsSocket, NapCatWsCreateOptions } from '../../src/ws-types.js';

export default defineAdapter<NapCatEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // OneBot file 参数原生消费 url / base64:// 媒体，file:// 本地路径由 NapCat 侧读盘；
  // 无卡片交互面，交互段降级纯文本。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'base64', 'path'],
          interactive: 'text',
        },
        quote: true,
        recall: {},
      },
      actions: {
        recall: { scopes: ['private', 'group'] },
        quoteReply: { scopes: ['private', 'group'] },
        announce: { scopes: ['group'], requiresRole: 'admin' },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
    // ADR 0056 §1：群消息带 sender.role，归一为 sender.platform.standing。
    group: { scene: { platformStanding: { standing: true } } },
  },
  createAdapter: context => new NapcatAdapter(context),
});
