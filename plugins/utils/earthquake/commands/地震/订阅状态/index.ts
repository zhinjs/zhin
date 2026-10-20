import { defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { formatEventTime, sourceLabel } from '../../../src/format.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { subscriptionKey } from '../../../src/subscriptions.js';

export default defineCommand({
  description: '查看当前会话的地震订阅与数据源状态',
  async execute({ input, use }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input);
    const subscription = await service.store.get(subscriptionKey(target));
    const timezone = service.config.timezone;
    const lines: string[] = [];
    if (subscription) {
      const regionText = subscription.regions.length > 0 ? subscription.regions.join('、') : '全球';
      lines.push(`本会话订阅：M${subscription.minMagnitude.toFixed(1)} 以上，地区：${regionText}`);
    } else {
      lines.push('本会话未订阅。订阅示例：地震 订阅 5 中国');
    }
    lines.push('数据源：');
    for (const health of service.health()) {
      let status = '正常';
      if (health.coolingDownUntil > 0) {
        status = `冷却至 ${formatEventTime(health.coolingDownUntil, timezone)}`;
      } else if (health.consecutiveFailures > 0) {
        status = `连续失败 ${health.consecutiveFailures} 次`;
      } else if (health.lastSuccessAt === undefined) {
        status = '尚未请求';
      }
      const reason = health.lastError ? `（${health.lastError}）` : '';
      lines.push(`- ${sourceLabel(health.id)}：${status}${reason}`);
    }
    return lines.join('\n');
  },
});
