import {
  databaseHostToken,
  definePlugin,
  outboundHostToken,
  scheduleHostToken,
  type PluginMetadata,
  type PluginDatabaseHost,
  type PluginSetupContext,
  type Token,
} from '@zhin.js/plugin-runtime';
import {
  createHostGameDb,
  createInMemoryGameDb,
  type InMemoryGameDb,
} from './memory-db.js';
import {
  defineGameRecordTable,
  GameRecordStore,
  type GameRecordDatabase,
  type GameRecordDatabaseHost,
} from './game-records.js';
import {
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from './runtime-constants.js';
import { defineGame, type RuntimeRegisteredGame } from './game-definition.js';
import type {
  BaseGameSessionRow,
  BaseSessionService,
} from './base-session-service.js';

export interface GamePluginSession<
  TRow extends BaseGameSessionRow = BaseGameSessionRow,
> {
  abortStale(
    idleMs: number,
    onTimeout?: (session: TRow) => void | Promise<void>,
  ): Promise<number>;
  readonly events: import('./game-events.js').GameEventBus;
  readonly gameId: string;
  getActiveForUser(channelKey: string, userId: string): Promise<{ readonly id: string; readonly channel_key: string } | null>;
  bindAvailability(availability: import('./session-coordinator.js').GameSessionAvailability): void;
}

export interface DefineGamePluginOptions<
  TServices,
  TRow extends BaseGameSessionRow = BaseGameSessionRow,
  TConfig = unknown,
> {
  readonly name: string;
  readonly metadata?: PluginMetadata;
  readonly game: RuntimeRegisteredGame;
  readonly tables: readonly string[];
  readonly servicesToken: Token<TServices>;
  /** Receives the owning plugin's logical database namespace, never the raw process host. */
  readonly defineHostTables: (host: PluginDatabaseHost) => void;
  readonly createServices: (database: InMemoryGameDb) => TServices;
  readonly session: (
    services: TServices,
  ) => GamePluginSession<TRow> | BaseSessionService<TRow>;
  readonly stale?: {
    readonly cron?: string;
    readonly idleMs?: number;
    readonly description?: string;
    readonly message?: string | ((session: TRow) => string);
    readonly onTimeout?: (
      session: TRow,
      context: PluginSetupContext<TConfig>,
    ) => void | Promise<void>;
  } | false;
  readonly setup?: (
    context: PluginSetupContext<TConfig>,
    services: TServices,
  ) => void | (() => void) | Promise<void | (() => void)>;
}

/**
 * Declarative Plugin Runtime assembly for games. Database selection, service
 * publication, Hub registration, stale cleanup and HMR disposal live here.
 */
export function defineGamePlugin<
  TServices,
  TRow extends BaseGameSessionRow = BaseGameSessionRow,
  TConfig = unknown,
>(
  options: DefineGamePluginOptions<TServices, TRow, TConfig>,
) {
  return definePlugin<TConfig>({
    name: options.name,
    metadata: options.metadata,
    async setup(context) {
      let database: InMemoryGameDb;
      if (context.resources.has(databaseHostToken)) {
        const host = context.resources.use(databaseHostToken);
        options.defineHostTables(host);
        defineGameRecordTable(host as GameRecordDatabaseHost);
        database = createHostGameDb(host, [...options.tables, 'game_records']);
      } else {
        database = createInMemoryGameDb([...options.tables, 'game_records']);
      }

      const services = options.createServices(database);
      context.resources.provide(options.servicesToken, services);
      const records = new GameRecordStore(database as unknown as GameRecordDatabase);
      const session = options.session(services);
      context.addGame(options.game.id, defineGame(options.game, records, session));
      context.lifecycle.add(session.events.on('game:end', async (event) => {
        if (event.gameId !== options.game.id || event.outcomes.length === 0) return;
        const row = event.session;
        if (!row.adapter || !row.endpoint || !row.channel_type || !row.channel_id) return;
        for (const outcome of event.outcomes) {
          await records.record({
            $adapter: row.adapter,
            $endpoint: row.endpoint,
            $channel: { type: row.channel_type, id: row.channel_id },
            $sender: {
              id: outcome.userId,
              name: outcome.userName ?? outcome.userId,
            },
          }, event.gameId, outcome.result, outcome.score);
        }
      }));

      if (options.stale !== false && context.resources.has(scheduleHostToken)) {
        const stale = options.stale ?? {};
        const schedule = context.resources.use(scheduleHostToken);
        context.lifecycle.add(schedule.register({
          id: `${options.game.id}/abort-stale`,
          cron: stale.cron ?? DEFAULT_GAME_STALE_CRON,
          description: stale.description
            ?? `Abort stale ${options.name} sessions`,
          async execute() {
            await session.abortStale(
              stale.idleMs ?? DEFAULT_GAME_STALE_IDLE_MS,
              async (row) => {
                await stale.onTimeout?.(row, context);
                if (!context.resources.has(outboundHostToken)) return;
                if (!row.adapter || !row.endpoint
                  || !row.channel_type || !row.channel_id) return;
                const outbound = context.resources.use(outboundHostToken);
                await outbound.send({
                  adapter: row.adapter,
                  endpointKey: row.endpoint,
                  conversation: {
                    kind: row.channel_type as 'private' | 'group' | 'channel',
                    id: row.channel_id,
                  },
                  content: typeof stale.message === 'function'
                    ? stale.message(row)
                    : stale.message
                      ?? `${options.game.icon} ${options.game.title}对局因长时间无操作已结束。`,
                });
              },
            );
          },
        }));
      }

      const dispose = await options.setup?.(context, services);
      if (dispose) context.lifecycle.add(dispose);
    },
  });
}
