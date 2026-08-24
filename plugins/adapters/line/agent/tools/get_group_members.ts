import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ groupId: string }>({
  description: 'Get LINE group member IDs',
  adapter: 'line',
  inputSchema: z.object({
    groupId: z.string().min(1),
  }),
  async execute({ groupId }, context) {
    if (!groupId.startsWith('G')) {
      throw new Error(`Invalid groupId "${groupId}": must start with G`);
    }
    return context.$client.getGroupMemberIds(groupId);
  },
});
