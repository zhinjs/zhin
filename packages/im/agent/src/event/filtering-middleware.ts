import type { EventMiddleware, EventSystemAgentEvent } from './contracts.js';

export interface FilteringMiddlewareOptions {
  allowedEventTypes?: string[];
  deniedEventTypes?: string[];
}

export class FilteringMiddleware implements EventMiddleware {
  name = 'filtering';

  private readonly allowed: Set<string> | null;
  private readonly denied: Set<string>;

  constructor(options: FilteringMiddlewareOptions = {}) {
    this.allowed = options.allowedEventTypes?.length
      ? new Set(options.allowedEventTypes)
      : null;
    this.denied = new Set(options.deniedEventTypes ?? []);
  }

  async process(event: EventSystemAgentEvent): Promise<EventSystemAgentEvent | null> {
    if (this.denied.has(event.type)) return null;
    if (this.allowed && !this.allowed.has(event.type)) return null;
    return event;
  }
}
