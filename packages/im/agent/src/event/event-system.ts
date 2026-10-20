import { formatCompact, getLogger } from '@zhin.js/logger';
import type {
  EventHandler,
  EventMiddleware,
  EventSystemAgentEvent,
  EventSystemConfig,
} from './contracts.js';
import { LoggingMiddleware } from './logging-middleware.js';
import { FilteringMiddleware } from './filtering-middleware.js';

const logger = getLogger('EventSystem');

export class EventSystem {
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private readonly middleware: EventMiddleware[] = [];

  constructor(private readonly config: EventSystemConfig = {}) {}

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    return () => this.listeners.get(eventType)?.delete(handler);
  }

  addMiddleware(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
  }

  async emit(eventType: string, payload: unknown): Promise<void> {
    const event: EventSystemAgentEvent = {
      type: eventType,
      payload,
      timestamp: Date.now(),
      source: this.config.source,
    };

    let processedEvent: EventSystemAgentEvent | null = event;
    for (const mw of this.middleware) {
      processedEvent = await mw.process(processedEvent);
      if (!processedEvent) return;
    }

    const listeners = this.listeners.get(eventType) ?? new Set();
    await Promise.all(Array.from(listeners).map((h) => h(processedEvent!)));
  }

  emitFireAndForget(eventType: string, payload: unknown): void {
    this.emit(eventType, payload).catch((error) => {
      logger.warn(formatCompact({
        event: eventType,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

export function createEventSystem(config: EventSystemConfig = { source: 'zhin-agent' }): EventSystem {
  const system = new EventSystem(config);
  system.addMiddleware(new LoggingMiddleware());
  system.addMiddleware(new FilteringMiddleware({
    allowedEventTypes: config.allowedEventTypes,
    deniedEventTypes: config.deniedEventTypes,
  }));
  return system;
}
