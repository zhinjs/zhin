/**
 * Event System — 模块契约（与实现同步）。
 *
 * 实现：`EventSystem.on` / `emit` + `LoggingMiddleware` + `FilteringMiddleware`。
 *
 * 分工：与 `ZhinAgentEventEmitter`、Kernel RunEvent、plugin `before.*` 分离，见 CONTEXT.md。
 */

export interface EventSystemAgentEvent {
  type: string;
  payload: unknown;
  timestamp: number;
  source?: string;
}

export type EventHandler = (event: EventSystemAgentEvent) => void | Promise<void>;

export interface EventMiddleware {
  name: string;
  process(event: EventSystemAgentEvent): Promise<EventSystemAgentEvent | null>;
}

export interface EventSystemConfig {
  source?: string;
  /** 非空时仅放行列出的 event.type */
  allowedEventTypes?: string[];
  /** 丢弃列出的 event.type（优先于 allow） */
  deniedEventTypes?: string[];
}
