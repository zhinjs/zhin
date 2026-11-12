import { DingTalkAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/dingtalk/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type DingTalkEndpointConfig,
} from '../../src/protocol.js';

export { DingTalkEndpoint } from '../../src/endpoint.js';
export type { DingTalkEndpointOptions, DingTalkFetch } from '../../src/endpoint.js';

export default defineAdapter<DingTalkEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 钉钉机器人媒体消息仅消费远程 URL；Markdown 走原生 msgtype；
  // 原生按钮需配置固定互动卡片模板，由 Stream 接收回调。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url'],
          interactive: 'native',
          markdown: 'native',
        },
      },
      delivery: { send: true, spool: true },
    },
    // ADR 0056 §1：群聊回调的 isAdmin 归一 standing（admin / member，回调不区分群主）。
    group: { scene: { platformStanding: { standing: true } } },
  },
  createAdapter: context => new DingTalkAdapter(context),
});
