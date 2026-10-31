import { conversationRefKey } from 'zhin.js';
import {
  createRelationalTargetMigration,
  decodeTaskTarget,
  encodeStorageIdentity,
  encodeTaskTarget,
  orderedMigrationRows,
  targetMigrationDigest,
  type DeliveryTarget,
  type PluginDatabaseHost,
  type PluginDataMigrationProvider,
  type TargetMigrationScopes,
} from 'zhin.js/plugin-runtime';

/** Chat subscriptions use exact targets; historical selectors are inventory facts only. */
export function subscriptionMigrationScope(
  input: Readonly<{
    target?: DeliveryTarget;
    adapterName: string;
    endpointKey: string;
    channelType: string;
    channelId: string;
  }>,
): string {
  return input.target
    ? `canonical:${conversationRefKey(input.target)}`
    : `historical:${targetMigrationDigest({
        adapter_name: input.adapterName,
        endpoint_id: input.endpointKey,
        channel_type: input.channelType,
        channel_id: input.channelId,
      })}`;
}

export function createSubscriptionTargetMigration(
  input: Readonly<{ database: PluginDatabaseHost; scopes: TargetMigrationScopes }>,
): PluginDataMigrationProvider {
  const table = 'rss_subscriptions';
  return createRelationalTargetMigration({
    ...input,
    domain: 'rss',
    title: 'RSS subscription destinations',
    sourceVersion: 'subscription-alias-v0',
    tables: [table],
    async readUnits(reader) {
      const rows = await reader.model(table).select();
      const grouped = new Map<string, { query: Record<string, unknown>; rows: Record<string, unknown>[] }>();
      for (const row of rows) {
        const query = {
          adapter_name: row.adapter_name,
          endpoint_id: row.endpoint_id,
          channel_type: row.channel_type,
          channel_id: row.channel_id,
          target_json: row.target_json ?? null,
        };
        const id = targetMigrationDigest(query);
        const unit: { query: Record<string, unknown>; rows: Record<string, unknown>[] } = grouped.get(id) ?? {
          query,
          rows: [],
        };
        unit.rows.push(row);
        grouped.set(id, unit);
      }
      return [...grouped.entries()]
        .map(([id, unit]) => {
          let target: DeliveryTarget | undefined,
            status: 'canonical' | 'unresolved' | 'corrupt' = 'unresolved';
          if (unit.query.target_json !== null) {
            try {
              target = decodeTaskTarget(JSON.parse(String(unit.query.target_json)));
              status = 'canonical';
            } catch {
              status = 'corrupt';
            }
          }
          const selectors = {
            adapterName: String(unit.query.adapter_name),
            endpointKey: String(unit.query.endpoint_id),
            channelType: String(unit.query.channel_type),
            channelId: String(unit.query.channel_id),
          };
          return {
            id,
            title: `RSS: ${selectors.channelType}/${selectors.channelId}`,
            status,
            scope: subscriptionMigrationScope({ ...selectors, ...(target ? { target } : {}) }),
            records: [{ table, query: unit.query, rows: orderedMigrationRows(unit.rows) }],
            summary: { ...selectors, duplicateRows: unit.rows.length },
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    rewrite(unit, target) {
      const before = unit.records[0]!;
      const patch = {
        target_json: JSON.stringify(encodeTaskTarget(target)),
        adapter_name: encodeStorageIdentity(target.endpoint.adapter),
        endpoint_id: encodeStorageIdentity(target.endpoint.id),
        channel_type: target.kind,
        channel_id: target.id,
      };
      return {
        destinationScope: subscriptionMigrationScope({
          target,
          adapterName: target.endpoint.adapter,
          endpointKey: target.endpoint.id,
          channelType: target.kind,
          channelId: target.id,
        }),
        writes: [
          { before, after: { table, query: patch, rows: before.rows.map((row) => ({ ...row, ...patch })) }, patch },
        ],
      };
    },
  });
}
