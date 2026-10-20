import { defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { parseSubscribeArgs } from '../../../src/subscribe-args.js';
import { SubscriptionLimitError } from '../../../src/subscriptions.js';

export default defineCommand({
  description: '在当前会话订阅地震速报：地震 订阅 [最小震级] [地区...]',
  params: {
    filters: { type: 'word', rest: true, description: '可选：最小震级与地区关键词，如 5 四川 云南' },
  },
  async execute({ params, input, use }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input);
    const parsed = parseSubscribeArgs(params.filters ?? []);
    if ('error' in parsed) return parsed.error;

    const minMagnitude = parsed.minMagnitude ?? service.config.defaultMinMagnitude;
    try {
      const { created } = await service.store.upsert({
        adapter: target.adapter,
        endpointKey: target.endpointKey,
        conversationKind: target.conversationKind,
        conversationId: target.conversationId,
        minMagnitude,
        regions: parsed.regions,
        createdBy: target.senderId,
        createdAt: new Date().toISOString(),
      });
      const regionText = parsed.regions.length > 0 ? parsed.regions.join('、') : '全球';
      const lines = [
        `${created ? '已订阅' : '已更新订阅'}：M${minMagnitude.toFixed(1)} 以上，地区：${regionText}`,
      ];
      if (!service.canPush) {
        lines.push('⚠️ 当前运行环境没有出站发送能力，订阅已保存但暂时不会推送');
      }
      lines.push('取消订阅请发送：地震 退订');
      return lines.join('\n');
    } catch (error) {
      if (error instanceof SubscriptionLimitError) return error.message;
      throw error;
    }
  },
});
