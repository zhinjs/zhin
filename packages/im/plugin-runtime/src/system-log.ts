import type { DatabaseHost } from './database-host.js';

/**
 * 系统日志表（console logs 页数据源）定义与写入辅助。
 *
 * 列结构对齐 packages/im/core/src/models/system-log.ts（legacy SystemLogDefinition，
 * 读取端为 packages/host/http console-rest-pages registerLogsRoutes）。
 */
export const SYSTEM_LOG_TABLE = 'SystemLog';

export const SYSTEM_LOG_DEFINITION: Record<string, unknown> = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  level: { type: 'text', nullable: false },
  name: { type: 'text', nullable: false },
  message: { type: 'text', nullable: false },
  source: { type: 'text', nullable: false },
  timestamp: { type: 'date', nullable: false },
};

/**
 * 在 DatabaseHost 上注册系统日志表（幂等：已定义或已启动的 host 跳过）。
 * 必须在 host.start() 之前调用（define 在 started 后会抛错）。
 */
export function defineSystemLogTable(
  host: Pick<DatabaseHost, 'define' | 'tables' | 'started'>,
): void {
  if (host.started) return;
  if (!host.tables().includes(SYSTEM_LOG_TABLE)) {
    host.define(SYSTEM_LOG_TABLE, SYSTEM_LOG_DEFINITION);
  }
}

/**
 * 写一行系统日志；表未注册（或 host 未启动导致 model 缺失）时返回 false。
 * 写失败向上抛，由调用方决定降级策略。
 */
export async function insertSystemLogRow(
  host: Pick<DatabaseHost, 'models'>,
  row: Record<string, unknown>,
): Promise<boolean> {
  const model = host.models.get(SYSTEM_LOG_TABLE);
  if (!model) return false;
  await model.insert(row);
  return true;
}
