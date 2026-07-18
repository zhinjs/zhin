import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLineApiConfig } from '../../src/line-agent-deps.js';

export default defineAgentTool<{ groupId: string }>({
  description: 'Get LINE group member IDs',
  inputSchema: z.object({
    groupId: z.string().min(1),
  }),
  async execute({ groupId }) {
    if (!groupId.startsWith('G')) {
      throw new Error(`Invalid groupId "${groupId}": must start with G`);
    }
    const { accessToken, apiBaseUrl } = getLineApiConfig();
    const response = await fetch(`${apiBaseUrl}/v2/bot/group/${groupId}/members/ids`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Group Members API error ${response.status}: ${errorText}`);
    }
    return await response.json();
  },
});
