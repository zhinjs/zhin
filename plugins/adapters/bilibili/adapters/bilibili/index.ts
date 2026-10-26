/**
 * Convention entry: discover `adapters/bilibili/index.ts` → defineAdapter.
 * Experimental：轮询白名单视频评论；出站只进草稿队列，master 用 `bili-draft send <id>` 审批后才发出。
 */
import { defineAdapter } from 'zhin.js/adapter';
import { BilibiliEndpoint } from '../../src/endpoint.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from '../../src/protocol.js';
import { bilibiliEndpointRegistryToken, bilibiliRuntimeStateToken } from '../../src/bilibili-runtime-state.js';

export { BilibiliEndpoint } from '../../src/endpoint.js';
export type { BilibiliEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<BilibiliEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 评论只支持纯文本：Markdown 去格式、交互段降级纯文本，其余段 unsupported。
  segments: {
    supported: ['text', 'mention'],
    html: 'text',
    markdown: 'text',
    interactive: 'text',
  },
  create(context) {
    const config = resolveBilibiliConfig(context.config);
    context.use(bilibiliRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'polling',
    });
    const registry = context.use(bilibiliEndpointRegistryToken);
    const endpoint = new BilibiliEndpoint({ id: context.id, config, registry });
    registry.set(config.id, endpoint);
    return endpoint;
  },
});
