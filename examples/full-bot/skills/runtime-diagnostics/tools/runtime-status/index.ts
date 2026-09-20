import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool({
  description: 'Return a lightweight health snapshot for the full-bot Runtime',
  approval: 'never',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute() {
    return {
      ok: true,
      runtime: 'plugin',
      timestamp: new Date().toISOString(),
    };
  },
});
