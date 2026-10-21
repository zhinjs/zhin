import { canManageConversation, defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { SUBSCRIPTION_PERMISSION_DENIED_MESSAGE } from '../../../src/permission.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { subscriptionKey } from '../../../src/subscriptions.js';

export default defineCommand({
  description: '取消当前会话的地震速报订阅（群聊限群主、管理员或机器人主人）',
  async execute({ input, use, adapter, scene, sender }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input);
    if (!canManageConversation({ adapter, scene, sender })) return SUBSCRIPTION_PERMISSION_DENIED_MESSAGE;
    const removed = await service.store.remove(subscriptionKey(target));
    return removed ? '已取消本会话的地震速报订阅' : '本会话没有地震速报订阅';
  },
});
