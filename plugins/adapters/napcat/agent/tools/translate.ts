import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getEndpoint } from '../../src/napcat-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; text: string }>({
  description: '英译中翻译。',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    text: z.string().describe('要翻译的英文文本'),
  }),
  platforms: ['napcat'],
  tags: ['napcat', 'qq'],
  keywords: ['翻译', 'translate', '英译中'],
  async execute({ endpoint_id, text }: { endpoint_id: string; text: string }) {
    const endpoint = getEndpoint(endpoint_id);
      return endpoint.translateEn2Zh(text);
  },
});
