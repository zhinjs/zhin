import type { AgentSessionHostPort } from '@zhin.js/agent';

declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      agentSessionHost?: AgentSessionHostPort;
    }
  }
}

export {};
