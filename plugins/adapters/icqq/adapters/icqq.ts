/**
 * Convention entry: discover `adapters/icqq.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { IcqqEndpoint } from '../src/endpoint.js';
import { icqqRuntimeStateToken } from '../src/icqq-runtime-state.js';
import {
  resolveIcqqConfig,
  type IcqqAdapterConfig,
} from '../src/protocol.js';

export { IcqqEndpoint } from '../src/endpoint.js';
export type { IcqqEndpointOptions } from '../src/endpoint.js';

declare module '@zhin.js/core' {
  interface AdapterEndpoints {
    icqq: import('../src/endpoint.js').IcqqEndpoint;
  }
}

export default defineAdapter<IcqqAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall', 'reaction'],
  segments: {
    outboundMedia: ['base64', 'url', 'path'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveIcqqConfig(context.config);
    // 注册到插件运行时状态（icqq.endpoint list 的"运行中"数据源）
    context.use(icqqRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'direct',
    });
    return new IcqqEndpoint({
      id: context.id,
      loginAssist: context.use(loginAssistToken),
      config,
    });
  },
});
