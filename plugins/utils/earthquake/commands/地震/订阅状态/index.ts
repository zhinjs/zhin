import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { formatEventTime, sourceLabel } from '../../../src/format.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { subscriptionKey } from '../../../src/subscriptions.js';

export default defineCommand({
  alias: ['earthquake status'],
  preferredAliasI18n: { en: 'earthquake status' },
  description: '查看当前会话的地震订阅与数据源状态', descriptionI18n: { en: "View this conversation's earthquake subscription and data source status" },
  async execute({ input, use, locale, formatCommand }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input, locale);
    const subscription = await service.store.get(subscriptionKey(target));
    const timezone = service.config.timezone;
    const lines: string[] = [];
    if (subscription) {
      const regionText = subscription.regions.length > 0 ? subscription.regions.join(locale === 'en' ? ', ' : '、') : t(locale, 'global');
      lines.push(t(locale, 'subscription', { magnitude: subscription.minMagnitude.toFixed(1), regions: regionText }));
    } else {
      lines.push(t(locale, 'emptyStatus'));
      const command = formatCommand('地震 订阅');
      if (command !== undefined) lines.push(t(locale, 'example', { command: `${command} 5 ${locale === 'en' ? 'China' : '中国'}` }));
    }
    lines.push(t(locale, 'dataSources'));
    for (const health of service.health()) {
      let status = t(locale, 'healthy');
      if (health.coolingDownUntil > 0) {
        status = t(locale, 'coolUntil', { time: formatEventTime(health.coolingDownUntil, timezone) });
      } else if (health.consecutiveFailures > 0) {
        status = t(locale, 'failures', { count: health.consecutiveFailures });
      } else if (health.lastSuccessAt === undefined) {
        status = t(locale, 'notRequested');
      }
      const reason = health.lastError ? `（${health.lastError}）` : '';
      lines.push(`- ${sourceLabel(health.id)}：${status}${reason}`);
    }
    return lines.join('\n');
  },
});
