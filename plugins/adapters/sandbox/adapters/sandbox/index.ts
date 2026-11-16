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
        // ADR 0064 §0.1 / §2：Sandbox 是能力上界——每项出站能力都声明最高档，页面对目录里的每种段
        // 都有专用渲染器（tests/sandbox-profile-ceiling.test.ts 与 sandbox-segment-renderers.test.ts 守住）。
        segments: {
          html: 'direct',
          markdown: 'native',
          outboundMedia: ['url', 'base64', 'path'],
          interactive: 'native',
        },
        // ADR 0064 §5：端点原生流式（`streaming` 配置关闭时装配期告警声明不一致）。
        streaming: { mode: 'native', formats: ['text', 'markdown'] },
        mention: { user: true, all: true },
        quote: true,
        // ADR 0064 P1b（D9）：端点 control 端口以 recall / edit / reaction 帧实现，页面就地应用。
        recall: { others: true },
        edit: true,
        reaction: {},
      },
      actions: {
        recall: { scopes: ['private', 'group', 'channel'], params: { others: true } },
        reaction: { scopes: ['private', 'group', 'channel'], params: { own: true, others: true, cancellable: true } },
        quoteReply: { scopes: ['private', 'group', 'channel'] },
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
