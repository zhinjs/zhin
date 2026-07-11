import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineTool({
  description: 'Echo a message back (minimal-bot agent/ demo)',
  inputSchema: z.object({ message: z.string().min(1) }),
  async execute({ message }) {
    return `echo: ${message}`;
  },
});
