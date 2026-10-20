import { createToken } from '@zhin.js/plugin-runtime';
import type { AgentEventBus } from '../event/ai-event-bus.js';

/** Generation-owned Agent lifecycle event publication boundary. */
export const agentEventBusToken = createToken<AgentEventBus>(
  'zhin.agent.event-bus',
  'Agent lifecycle event bus owned by one Runtime generation',
);
