import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getLineApiConfig } from '../../src/line-agent-deps.js';

export default defineTool<{ userId: string }>({
  description: 'Get LINE user profile by userId',
  inputSchema: z.object({
    userId: z.string().min(1),
  }),
  async execute({ userId }) {
    if (!userId.startsWith('U')) {
      throw new Error(`Invalid userId "${userId}": must start with U`);
    }
    const { accessToken, apiBaseUrl } = getLineApiConfig();
    const response = await fetch(`${apiBaseUrl}/v2/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Profile API error ${response.status}: ${errorText}`);
    }
    return await response.json();
  },
});
