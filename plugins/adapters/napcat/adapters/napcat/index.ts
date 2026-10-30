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
  operations: ['recall'],
  // OneBot file 参数原生消费 url / base64:// 媒体，file:// 本地路径由 NapCat 侧读盘；
  // 无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'base64', 'path'],
    interactive: 'text',
  },
  createAdapter: context => new NapcatAdapter(context),
});
