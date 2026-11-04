import { createGameTargetMigration } from './target-migration.js';
import { gameTargetFromKey } from './board-sender.js';
import { sendGameSessionMessage } from './session-delivery.js';
import {
  databaseHostToken,
  pluginDataMigrationProviderToken,
  TargetMigrationScopes,
  definePlugin,
  outboundHostToken,
  resolveLocale,
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
import { gameMessages } from './messages.js';

export interface GamePluginSession<
  TRow extends BaseGameSessionRow = BaseGameSessionRow,
> {
  abortStale(
    idleMs: number,
    onTimeout?: (session: TRow) => void | Promise<void>,
  ): Promise<number>;
  readonly events: import('./game-events.js').GameEventBus;
  readonly gameId: string;
  readonly storageTable: string;
  bindMigrationScopes(scopes: TargetMigrationScopes): void;
  runInScope<T>(input: Readonly<{ scope: string; run: () => Promise<T> }>): Promise<T>;
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
      let durable: PluginDatabaseHost | undefined;
      if (context.resources.has(databaseHostToken)) {
        const host = context.resources.use(databaseHostToken);
        durable = host;
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
      if (durable) {
        const scopes = new TargetMigrationScopes({ pending: scope => !gameTargetFromKey(scope) });
        session.bindMigrationScopes(scopes);
        context.resources.provide(pluginDataMigrationProviderToken, createGameTargetMigration({ database: durable,
          gameId: options.game.id, sessionTable: session.storageTable, tables: options.tables, scopes }));
      }
      context.addGame(options.game.id, defineGame(options.game, records, session));
      context.lifecycle.add(session.events.on('game:end', async (event) => {
        if (event.gameId !== options.game.id || event.outcomes.length === 0) return;
        const row = event.session;
        for (const outcome of event.outcomes) {
          await records.record({ scope: row.channel_key, player: { id: outcome.userId, name: outcome.userName },
            gameId: event.gameId, result: outcome.result, score: outcome.score });
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
                const outbound = context.resources.use(outboundHostToken);
                const locale = resolveLocale(row.locale);
                await sendGameSessionMessage({ outbound, session: row,
                  content: typeof stale.message === 'function' ? stale.message(row) : stale.message
                    ?? gameMessages(locale, 'stale', { icon: options.game.icon,
                      title: options.game.titleI18n?.[locale] ?? options.game.title }) });
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
