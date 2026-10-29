/**
 * Convention entry: discover `adapters/bilibili/index.ts` → defineAdapter.
 * Experimental：轮询白名单视频评论；出站只进草稿队列，master 在 Console「评论审批」页或用 `bili-draft send <id>` 审批后才发出。
 */
import { defineAdapter } from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import { BilibiliEndpoint } from '../../src/endpoint.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from '../../src/protocol.js';
import { formatNotice } from '../../src/review.js';
import {
  bilibiliEndpointRegistryToken,
  bilibiliNotifierToken,
  bilibiliRuntimeStateToken,
} from '../../src/bilibili-runtime-state.js';

export { BilibiliEndpoint } from '../../src/endpoint.js';
export type { BilibiliEndpointOptions } from '../../src/endpoint.js';

export default defineAdapter<BilibiliEndpointConfig>({
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
        maxLength: 1000,
      },
      delivery: { send: true },
    },
  },
  create(context) {
    const config = resolveBilibiliConfig(context.config);
    context.use(bilibiliRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'polling',
    });
    const registry = context.use(bilibiliEndpointRegistryToken);
    const notifier = context.use(bilibiliNotifierToken);
    const logger = getAdapterLogger('bilibili', config.id);
    const target = config.notify;
    const endpoint = new BilibiliEndpoint({
      id: context.id,
      config,
      registry,
      stateDir: config.dataDir,
      notify: async (notice) => {
        if (!target) return;
        // 默认命令前缀为空；配置了前缀的用户在提示里看到的是不带前缀的命令名。
        const sent = await notifier(target, formatNotice(notice, { formatCommand: (path) => path }));
        if (!sent) logger.info(formatCompact({ op: 'bilibili_notify_skipped', kind: notice.kind, hint: '没有可用的出站通道' }));
      },
    });
    registry.set(config.id, endpoint);
    return endpoint;
  },
});
