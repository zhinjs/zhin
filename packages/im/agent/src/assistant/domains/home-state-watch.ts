/**
 * HomeStateWatch — alias filter, debounce, format, NotificationRouter deliver.
 * Does not go through HomeFacade (system push path).
 */
import { getLogger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import type { NotificationRouter } from '../notification-router.js';
import type { JobNotify } from '../types.js';
import { DEFAULT_DEBOUNCE_MS } from '../home-config.js';
import {
  HaWsTransport,
  buildWsUrl,
  type CreateHaSocket,
  type HaStateChangedEvent,
} from './ha-ws-transport.js';

const logger = getLogger('home-state-watch');

export interface HomeStateWatchOptions {
  wsUrl: string;
  token: string;
  /** alias → entity_id (pre-resolved at bootstrap) */
  entityToAlias: Map<string, string>;
  debounceMs?: number;
  notify: JobNotify;
  router: NotificationRouter;
  createSocket?: CreateHaSocket;
  createTransport?: (opts: {
    wsUrl: string;
    token: string;
    onStateChanged: (e: HaStateChangedEvent) => void;
    createSocket?: CreateHaSocket;
  }) => { start(): void; dispose(): void };
}

export class HomeStateWatch {
  private transport: { start(): void; dispose(): void } | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly options: HomeStateWatchOptions) {}

  start(): void {
    if (this.disposed) return;
    if (this.options.entityToAlias.size === 0) {
      logger.info('home-state-watch: no entities, skipping');
      return;
    }

    const onStateChanged = (event: HaStateChangedEvent) => {
      this.handleStateChanged(event);
    };

    if (this.options.createTransport) {
      this.transport = this.options.createTransport({
        wsUrl: this.options.wsUrl,
        token: this.options.token,
        onStateChanged,
        createSocket: this.options.createSocket,
      });
    } else {
      this.transport = new HaWsTransport({
        wsUrl: this.options.wsUrl,
        token: this.options.token,
        createSocket: this.options.createSocket,
        onStateChanged,
      });
    }
    this.transport.start();
    logger.info(formatCompact({
      op: 'home_watch_started',
      entities: this.options.entityToAlias.size,
      debounceMs: this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    }));
  }

  /** Visible for tests — simulate a transport state event. */
  handleStateChanged(event: HaStateChangedEvent): void {
    const alias = this.options.entityToAlias.get(event.entityId);
    if (!alias) return;
    this.debouncedNotify(alias, event.entityId, event.newState, event.attributes);
  }

  private debouncedNotify(
    alias: string,
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
  ): void {
    const debounceMs = this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const existing = this.debounceTimers.get(entityId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(entityId);
      void this.deliver(alias, entityId, state, attributes);
    }, debounceMs);
    this.debounceTimers.set(entityId, timer);
  }

  private async deliver(
    alias: string,
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    const content = formatStateMessage(alias, state, attributes);
    try {
      await this.options.router.deliver({
        notify: this.options.notify,
        content,
        source: 'ha-ws-watcher',
      });
      logger.debug(formatCompact({ op: 'ha_ws_notify', alias, entityId, state }));
    } catch (err) {
      logger.warn(formatCompact({ op: 'ha_ws_notify_error', alias, error: String(err) }));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.transport?.dispose();
    this.transport = null;
  }
}

export function formatStateMessage(
  alias: string,
  state: string,
  attributes: Record<string, unknown>,
): string {
  const parts = [`设备「${alias}」状态变更: ${state}`];
  if (attributes.brightness !== undefined) parts.push(`亮度: ${attributes.brightness}`);
  if (attributes.temperature !== undefined) parts.push(`温度: ${attributes.temperature}°C`);
  if (attributes.current_temperature !== undefined) parts.push(`当前温度: ${attributes.current_temperature}°C`);
  if (attributes.current_position !== undefined) parts.push(`位置: ${attributes.current_position}%`);
  return parts.join('，');
}

export { buildWsUrl };

/** Build entity→alias map from alias→entity record for watch list. */
export function buildWatchEntityMap(
  aliases: Record<string, string>,
  watchAliases: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const alias of watchAliases) {
    const entityId = aliases[alias.trim()];
    if (!entityId) {
      logger.warn(formatCompact({ op: 'ha_ws_skip_alias', alias, reason: 'unknown_alias' }));
      continue;
    }
    map.set(entityId, alias.trim());
  }
  return map;
}
