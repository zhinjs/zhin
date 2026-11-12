/**
 * Convention entry: discover `adapters/sandbox/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { SandboxAdapter } from '../../src/adapter.js';
import {
  type SandboxEndpointConfig,
} from '../../src/protocol.js';

export { SandboxWsEndpoint } from '../../src/endpoint.js';
export type { SandboxEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<SandboxEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  profile: {
    default: {
      messaging: {
        // Console UI 直连 URL 媒体、直接渲染 base64 内联媒体；path 由端点读盘
        // 物化为 base64 内联（sandbox 无平台上传通道）。交互段由 Console 原生承载。
        segments: {
          html: 'direct',
          markdown: 'native',
          outboundMedia: ['url', 'base64', 'path'],
          interactive: 'native',
        },
      },
      delivery: { send: true, proactive: true, spool: true },
      // The authenticated local ingress: its configured owner may turn wire metadata into agent-run authority.
      runtime: { sandbox: true },
    },
    // ADR 0056 §1：模拟器的发送者角色（master = 群主 / admin / member）作为平台身份上报。
    group: { scene: { platformStanding: { standing: true } } },
    channel: { scene: { platformStanding: { standing: true } } },
  },
  createAdapter: context => new SandboxAdapter(context),
});
