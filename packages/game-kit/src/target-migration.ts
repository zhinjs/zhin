import {
  createRelationalTargetMigration,
  encodeStorageIdentity,
  orderedMigrationRows,
  targetMigrationDigest,
  type PluginDatabaseHost,
  type PluginDataMigrationProvider,
  type RelationalTargetMigrationUnit,
  type TargetMigrationRows,
  type TargetMigrationScopes,
  type TargetMigrationWrite,
} from '@zhin.js/plugin-runtime';
import { channelKey, gameTargetFromKey } from './board-sender.js';

/** Concrete game tables only: related moves/spectators keep their session references and IDs. */
export function createGameTargetMigration(
  input: Readonly<{
    database: PluginDatabaseHost;
    gameId: string;
    sessionTable: string;
    tables: readonly string[];
    scopes: TargetMigrationScopes;
  }>,
): PluginDataMigrationProvider {
  const { database, gameId, sessionTable, scopes } = input;
  const tables = [...new Set([...input.tables, 'game_records'])];
  return createRelationalTargetMigration({
    database,
    domain: `game:${gameId}`,
    title: `${gameId} historical sessions`,
    sourceVersion: 'game-alias-v0',
    tables,
    scopes,
    async readUnits(reader) {
      const grouped = new Map<string, TargetMigrationRows[]>();
      for (const table of [sessionTable, 'game_records', ...(tables.includes('ttt_queue') ? ['ttt_queue'] : [])]) {
        const rows = await reader.model(table).select();
        const byScope = new Map<string, Record<string, unknown>[]>();
        for (const row of rows) {
          if (typeof row.channel_key !== 'string' || !row.channel_key) continue;
          const group = byScope.get(row.channel_key) ?? [];
          group.push(row);
          byScope.set(row.channel_key, group);
        }
        for (const [scope, records] of byScope) {
          const sets = grouped.get(scope) ?? [];
          sets.push({ table, query: { channel_key: scope }, rows: orderedMigrationRows(records) });
          grouped.set(scope, sets);
        }
      }
      const units: RelationalTargetMigrationUnit[] = [];
      for (const [scope, records] of grouped) {
        let status: RelationalTargetMigrationUnit['status'] = 'unresolved';
        try {
          if (gameTargetFromKey(scope)) status = 'canonical';
        } catch {
          status = 'corrupt';
        }
        const sessions = records.find((set) => set.table === sessionTable)?.rows ?? [];
        for (const table of ['ttt_moves', 'ttt_spectators'].filter((name) => tables.includes(name))) {
          for (const session of sessions)
            records.push({
              table,
              query: { session_id: session.id },
              rows: orderedMigrationRows(await reader.model(table).select().where({ session_id: session.id })),
            });
        }
        const authorizationCandidates = tables.includes('roulette_group_settings')
          ? await reader.model('roulette_group_settings').select().where({ id: scope })
          : [];
        if (authorizationCandidates.length)
          records.push({ table: 'roulette_group_settings', query: { id: scope }, rows: authorizationCandidates });
        units.push({
          id: targetMigrationDigest({ gameId, scope }),
          title: `${gameId}: ${scope}`,
          scope,
          status,
          records,
          summary: {
            gameId,
            scope,
            sessionIds: sessions.map((row) => String(row.id)),
            activeSessionIds: sessions.filter((row) => row.status === 'active').map((row) => String(row.id)),
          },
          authorizationCandidates: authorizationCandidates.map((row) => ({
            kind: 'roulette-mute-penalty',
            source: row as never,
            reason: 'Historical permission is displayed only; authorize the canonical scope separately.',
          })),
        });
      }
      return units.sort((a, b) => a.id.localeCompare(b.id));
    },
    rewrite(unit, target) {
      const destinationScope = channelKey({ target });
      const writes: TargetMigrationWrite[] = [];
      for (const before of unit.records) {
        if (before.table !== sessionTable && before.table !== 'game_records' && before.table !== 'ttt_queue') continue;
        const patch =
          before.table === sessionTable
            ? {
                channel_key: destinationScope,
                adapter: encodeStorageIdentity(target.endpoint.adapter),
                endpoint: encodeStorageIdentity(target.endpoint.id),
                channel_type: target.kind,
                channel_id: encodeStorageIdentity(target.id),
                ...(gameId === 'roulette'
                  ? {
                      endpoint_adapter: encodeStorageIdentity(target.endpoint.adapter),
                      endpoint_id: encodeStorageIdentity(target.endpoint.id),
                    }
                  : {}),
              }
            : { channel_key: destinationScope };
        writes.push({
          before,
          after: {
            table: before.table,
            query: { channel_key: destinationScope },
            rows: before.rows.map((row) => ({ ...row, ...patch })),
          },
          patch,
        });
      }
      return { destinationScope, writes };
    },
  });
}
