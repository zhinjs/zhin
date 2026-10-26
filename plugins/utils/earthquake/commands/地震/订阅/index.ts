import { messages as t } from '../../../src/i18n.js';
import { canManageConversation, defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { parseSubscribeArgs } from '../../../src/subscribe-args.js';
import { SubscriptionLimitError } from '../../../src/subscriptions.js';

export default defineCommand({
  alias: ['earthquake subscribe'],
  preferredAliasI18n: { en: 'earthquake subscribe' },
  description: '在当前会话订阅地震速报：地震 订阅 [最小震级] [地区...]（群聊限群主、管理员或机器人主人）', descriptionI18n: { en: "Subscribe this conversation to earthquake alerts (group owner, administrator or bot master required in groups)" },
  params: {
    filters: { type: 'word', rest: true, description: '可选：最小震级与地区关键词，如 5 四川 云南', descriptionI18n: { en: "Optional minimum magnitude and region keywords, such as 5 Sichuan Yunnan" } },
  },
  async execute({ params, input, use, adapter, scene, sender, locale, formatCommand }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input, locale);
    if (!canManageConversation({ adapter, scene, sender })) return t(locale, 'denied');
    const parsed = parseSubscribeArgs(params.filters ?? [], locale);
    if ('error' in parsed) return parsed.error;

    const minMagnitude = parsed.minMagnitude ?? service.config.defaultMinMagnitude;
    try {
      const { created } = await service.store.upsert({
        locale,
        adapter: target.adapter,
        endpointKey: target.endpointKey,
        conversationKind: target.conversationKind,
        conversationId: target.conversationId,
        minMagnitude,
        regions: parsed.regions,
        createdBy: target.senderId,
        createdAt: new Date().toISOString(),
      });
      const regionText = parsed.regions.length > 0 ? parsed.regions.join(locale === 'en' ? ', ' : '、') : t(locale, 'global');
      const lines = [
        t(locale, created ? 'subscribed' : 'updated', { magnitude: minMagnitude.toFixed(1), regions: regionText }),
      ];
      if (!service.canPush) {
        lines.push(t(locale, 'noPush'));
      }
      const command = formatCommand('地震 退订');
      if (command !== undefined) lines.push(t(locale, 'unsubscribeHint', { command }));
      return lines.join('\n');
    } catch (error) {
      if (error instanceof SubscriptionLimitError) return t(locale, 'limit', { limit: error.limit });
      throw error;
    }
  },
});
