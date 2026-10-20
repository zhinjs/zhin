import { defineCommand } from 'zhin.js/command';
import { conversationError, extractConversation } from '../../../src/conversation.js';
import { earthquakeServiceToken } from '../../../src/runtime.js';
import { subscriptionKey } from '../../../src/subscriptions.js';

export default defineCommand({
  description: '取消当前会话的地震速报订阅',
  async execute({ input, use }) {
    const service = use(earthquakeServiceToken);
    const target = extractConversation(input);
    if (!target) return conversationError(input);
    const removed = await service.store.remove(subscriptionKey(target));
    return removed ? '已取消本会话的地震速报订阅' : '本会话没有地震速报订阅';
  },
});
