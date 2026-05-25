import { DatabaseFeature, type Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import { resolveEdgeDatabaseConfig } from './resolve-edge-database.js';

function isCloudflareWorkers(): boolean {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
  return ua.includes('Cloudflare-Workers');
}

export function applyEdgeDatabase(plugin: Plugin, appConfig: AppConfig): boolean {
  const database = resolveEdgeDatabaseConfig(appConfig);
  if (!database?.dialect) return false;
  if (database.dialect === 'sqlite' && isCloudflareWorkers()) {
    plugin.logger.warn(
      'Workers: 跳过 sqlite（无持久磁盘）；生产请设置 DATABASE_URL（PostgreSQL）',
    );
    return false;
  }
  plugin.provide(new DatabaseFeature(database as ConstructorParameters<typeof DatabaseFeature>[0]));
  return true;
}
