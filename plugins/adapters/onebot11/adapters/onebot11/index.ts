/**
 * Convention entry: discover `adapters/onebot11/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { Onebot11Adapter } from '../../src/adapter.js';
import {
  type OneBot11EndpointConfig,
} from '../../src/protocol.js';

export { OneBot11WsEndpoint } from '../../src/ws-endpoint.js';
export type { OneBot11WsEndpointOptions } from '../../src/ws-endpoint.js';
export { OneBot11WssEndpoint } from '../../src/wss-endpoint.js';
export type { OneBot11WssEndpointOptions } from '../../src/wss-endpoint.js';
export type { OneBot11WsSocket, OneBot11WsCreateOptions } from '../../src/ws-types.js';

export default defineAdapter<OneBot11EndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // OneBot file 参数原生消费 url / base64:// 媒体；无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'base64'],
    interactive: 'text',
  },
  createAdapter: context => new Onebot11Adapter(context),
});
