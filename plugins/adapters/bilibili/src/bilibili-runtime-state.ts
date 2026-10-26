/**
 * Bilibili 插件实例的运行时状态：
 * - `bilibiliRuntimeStateToken`：adapter create() 注册的 endpoint 列表（通用 endpoint 命令用）。
 * - `bilibiliEndpointRegistryToken`：endpoint id → 实例，供 `bili-draft` 审批命令找到草稿队列。
 */
import { createToken } from 'zhin.js';
import { defineEndpointRuntimeStateToken } from 'zhin.js/adapter';
import type { BilibiliEndpoint } from './endpoint.js';

export const bilibiliRuntimeStateToken = defineEndpointRuntimeStateToken('bilibili');

export type BilibiliEndpointRegistry = Map<string, BilibiliEndpoint>;

export const bilibiliEndpointRegistryToken = createToken<BilibiliEndpointRegistry>(
  'zhin.bilibili-comment.endpoints',
  'Owner-scoped Bilibili comment endpoints (draft review)',
);
