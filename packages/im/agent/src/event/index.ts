/**
 * Event System — Agent turn 域事件 + ZhinAgentEventEmitter 适配。
 */

export type {
  EventSystemAgentEvent,
  EventHandler,
  EventMiddleware,
  EventSystemConfig,
} from './contracts.js';

export { EventSystem, createEventSystem } from './event-system.js';
export { FilteringMiddleware } from './filtering-middleware.js';
export type { FilteringMiddlewareOptions } from './filtering-middleware.js';
export { ZhinAgentEventEmitter } from './event-emitter.js';

export { emitSessionNewEvent, emitSessionCompactEvent } from './session-events.js';

export type {
  TurnEvent,
  TurnUsage,
  TurnStartEvent,
  ChunkEvent,
  ToolCallEvent,
  ToolResultEvent,
  ThinkingEvent,
  TurnEndEvent,
  TurnErrorEvent,
  SubagentStartEvent,
  SubagentProgressEvent,
  SubagentEndEvent,
  McpConnectEvent,
  McpToolCallEvent,
} from './turn-event.js';
