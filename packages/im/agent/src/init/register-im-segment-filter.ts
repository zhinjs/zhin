/**
 * AI 出站 IM 可见性过滤 — 经 dispatcher.addOutboundPolish 挂到 before.sendMessage。
 * thinking / tool_call 等 AI-only 段写入 agent_messages，但不过网到用户 IM。
 */
import { getPlugin, type OutboundPolishMiddleware } from '@zhin.js/core';
import { filterImDeliveryContent } from '../segment/filter-im-delivery.js';

export function registerImSegmentFilter(): void {
  const plugin = getPlugin();
  const dispatcher = plugin.root.inject('dispatcher') as
    | { extensions?: { addOutboundPolish?: (handler: OutboundPolishMiddleware) => () => void } }
    | undefined;

  if (!dispatcher?.extensions?.addOutboundPolish) return;

  const dispose = dispatcher.extensions.addOutboundPolish((ctx) => {
    if (ctx.source !== 'ai') return;
    return filterImDeliveryContent(ctx.content as never);
  });
  plugin.onDispose(dispose);
}
