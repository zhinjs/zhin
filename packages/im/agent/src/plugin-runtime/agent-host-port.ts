import { createToken } from '@zhin.js/plugin-runtime';

/**
 * Stable Host boundary for protocols that expose Agent capabilities externally.
 * Consumers must not reach into CLI installer state or the legacy Plugin graph.
 */
export interface AgentHostPort {
  /** Concrete Agent classes stay private to the composing package. */
  readonly service: unknown;
  readonly agent: unknown;
}

export const agentHostToken = createToken<AgentHostPort>(
  'zhin.host.agent',
  'Active AIService and ZhinAgent owned by the Root generation',
);
