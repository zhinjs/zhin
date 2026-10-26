import { messages as t } from '../../../src/i18n.js';
import { canManageConversation, defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { subscriptionKey } from '../../../src/subscriptions.js';

export default defineCommand({
  alias: ['earthquake unsubscribe'],
  preferredAliasI18n: { en: 'earthquake unsubscribe' },
  description: '取消当前会话的地震速报订阅（群聊限群主、管理员或机器人主人）', descriptionI18n: { en: "Unsubscribe this conversation from earthquake alerts (group owner, administrator or bot master required in groups)" },
  async execute({ input, use, adapter, scene, sender, locale }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input, locale);
    if (!canManageConversation({ adapter, scene, sender })) return t(locale, 'denied');
    const removed = await service.store.remove(subscriptionKey(target));
    return t(locale, removed ? 'removed' : 'notSubscribed');
  },
});
