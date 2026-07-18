import { formatCompact, getLogger } from '@zhin.js/logger';
import type { EventMiddleware, EventSystemAgentEvent } from './contracts.js';

const logger = getLogger('EventSystem:Logging');

export class LoggingMiddleware implements EventMiddleware {
  name = 'logging';

  async process(event: EventSystemAgentEvent): Promise<EventSystemAgentEvent> {
    if (process.env.NODE_ENV === 'test') return event;
    logger.debug(formatCompact({
      event: event.type,
      source: event.source,
      ts: event.timestamp,
    }));
    return event;
  }
}
