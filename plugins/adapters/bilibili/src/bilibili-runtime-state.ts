/**
 * Bilibili 插件实例的运行时状态：
 * - `bilibiliRuntimeStateToken`：adapter create() 注册的 endpoint 列表（通用 endpoint 命令用）。
 * - `bilibiliEndpointRegistryToken`：endpoint id → 实例，供 `bili-draft` 审批命令与 Console 页找到草稿队列。
 * - `bilibiliNotifierToken`：把新草稿 / 登录失效推给 master 配置的聊天会话（没有 OutboundHost 时为空操作）。
 */
import { createToken } from 'zhin.js';
import { defineEndpointRuntimeStateToken } from 'zhin.js/adapter';
import type { BilibiliEndpoint } from './endpoint.js';
import type { ResolvedBilibiliNotifyTarget } from './protocol.js';

export const bilibiliRuntimeStateToken = defineEndpointRuntimeStateToken('bilibili');

export type BilibiliEndpointRegistry = Map<string, BilibiliEndpoint>;

export const bilibiliEndpointRegistryToken = createToken<BilibiliEndpointRegistry>(
  'zhin.bilibili-comment.endpoints',
  'Owner-scoped Bilibili comment endpoints (draft review)',
);

/** 返回 false 表示当前没有可用的出站通道（只记日志）。 */
export type BilibiliNotifier = (target: ResolvedBilibiliNotifyTarget, text: string) => Promise<boolean>;

export const bilibiliNotifierToken = createToken<BilibiliNotifier>(
  'zhin.bilibili-comment.notifier',
  'Pushes Bilibili draft / login notices to a configured chat conversation via OutboundHost',
);
