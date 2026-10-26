import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { bilibiliEndpointRegistryToken, bilibiliRuntimeStateToken } from './src/bilibili-runtime-state.js';

/**
 * Plugin Runtime:
 * - Adapter: `adapters/bilibili` 轮询白名单视频评论（可选「回复我的 / @我的」），出站只进草稿队列。
 * - Commands: `bili-draft list|show|edit|send|drop`（仅 master）人工审批后才真正发出。
 */
export default definePlugin({
  name: 'bilibili',
  metadata: {
    displayName: 'Bilibili Comment Adapter (Experimental)',
  },
  setup(context) {
    context.resources.provide(bilibiliRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(bilibiliEndpointRegistryToken, new Map());
  },
});
