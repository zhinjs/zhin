import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: 'Get the member IDs of the current LINE group',
  adapter: 'line',
  scopes: ["group"],
  inputSchema: z.object({}),
  async execute(_input, context) {
    // The trusted turn owns the group; model input cannot select another group the Bot is in.
    const { origin } = context;
    const conversation = origin?.kind === 'im' && origin.platform === 'line' ? origin.conversation : undefined;
    const groupId = conversation?.kind === 'group' || conversation?.kind === 'channel' ? conversation.id : '';
    if (!groupId || !/^[GR]/.test(groupId)) throw new Error('This operation requires the current LINE group');
    context.signal?.throwIfAborted();
    return context.$client.getGroupMemberIds(groupId);
  },
});
