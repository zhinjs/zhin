/**
 * Convention entry: discover `adapters/juejin/index.ts` → defineAdapter.
 * Experimental：轮询白名单文章评论；出站只进草稿队列，master 在 Console「掘金评论审批」页或用 `juejin-draft send <id>` 审批后才发出。
 */
import { defineAdapter } from 'zhin.js/adapter';
import { JuejinAdapter } from '../../src/adapter.js';
import type { JuejinEndpointConfig } from '../../src/protocol.js';

export { JuejinEndpoint } from '../../src/endpoint.js';
export type { JuejinEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<JuejinEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 评论只支持纯文本：Markdown 去格式、交互段降级纯文本，其余段 unsupported。
  profile: {
    default: {
      messaging: {
        segments: {
          supported: ['text', 'mention'],
          html: 'text',
          markdown: 'text',
          interactive: 'text',
        },
      },
      delivery: { send: true, spool: true },
    },
  },
  createAdapter: context => new JuejinAdapter(context),
});
