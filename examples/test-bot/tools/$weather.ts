import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { fetchWttrWeather } from '../lib/wttr.js';

export default defineAgentTool<{ city: string }>({
  description: 'Query live weather for a city via wttr.in',
  approval: 'never',
  inputSchema: z.object({
    city: z.string().min(1).max(80),
  }),
  execute: ({ city }) => fetchWttrWeather(city),
});
