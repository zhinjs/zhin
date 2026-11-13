/**
 * `zhin doctor` 10e (ADR 0059): the gateway store `.zhin/gateway.db` (owner-only file, import of
 * the old account tables, tables that reappeared in the project database) and the restricted
 * Console account on PostgreSQL / MySQL (`--fix` creates it like `zhin db console-role`).
 */
import { existsSync, statSync } from 'node:fs';
import {
  gatewayStorePath,
  loadExpandedProjectConfig,
  openGatewayStore,
  resolveProjectDatabaseConfig,
  setupConsoleRole,
} from '@zhin.js/gateway/database';
import { inspectLegacyIamImport, type LegacyImportInspection } from '@zhin.js/gateway/iam';
import { LOCAL_GATEWAY_RPC, LocalGatewayClient } from '@zhin.js/gateway/local';
import { describeLegacyImport } from '../commands/console.js';
import { describeConsoleRole } from '../commands/db.js';

export interface GatewayStorageCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface GatewayStorageCheckOptions {
  readonly fix?: boolean;
  /** A gateway runs for the project: its state is read over the local socket, gateway.db is not opened. */
  readonly gatewayRunning?: boolean;
  readonly environment?: string;
  /** Socket owner check override (tests). */
  readonly uid?: () => number | undefined;
}

export async function diagnoseGatewayStorage(projectRoot: string, options: GatewayStorageCheckOptions = {}): Promise<GatewayStorageCheck[]> {
  const results: GatewayStorageCheck[] = [];
  const environment = options.environment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const file = gatewayStorePath(projectRoot);
  const projectDatabase = async () => resolveProjectDatabaseConfig(projectRoot, await loadExpandedProjectConfig(projectRoot, environment));

  // ---- the file itself
  if (existsSync(file) && process.platform !== 'win32') {
    const loose = ['', '-wal', '-shm'].filter(suffix => existsSync(`${file}${suffix}`) && (statSync(`${file}${suffix}`).mode & 0o077) !== 0);
    results.push(loose.length
      ? { name: 'gateway.db 权限', status: 'warn', message: `.zhin/gateway.db${loose.join('/')} 不是 0600：其他用户可能读到 Console 账号与会话哈希`, fix: 'chmod 600 .zhin/gateway.db*' }
      : { name: 'gateway.db 权限', status: 'ok', message: '.zhin/gateway.db 仅所有者可读写（0600）' });
  }

  // ---- import of the old account tables
  let inspection: (LegacyImportInspection & { pending?: string; pendingCode?: string }) | undefined;
  let problem: string | undefined;
  try {
    if (options.gatewayRunning) {
      const client = await LocalGatewayClient.connect({ root: projectRoot, ...(options.uid ? { uid: options.uid } : {}) });
      try {
        inspection = await client.request(LOCAL_GATEWAY_RPC.CONSOLE_MIGRATION_STATUS);
      } finally {
        client.close();
      }
    } else if (existsSync(file)) {
      const store = await openGatewayStore(projectRoot);
      try {
        inspection = await inspectLegacyIamImport({ store, projectRoot, projectDatabase });
      } finally {
        await store.close();
      }
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  if (problem !== undefined) {
    results.push({ name: 'Console 账号存储', status: 'warn', message: `无法读取迁移状态：${problem}` });
  } else if (!inspection) {
    results.push({ name: 'Console 账号存储', status: 'ok', message: '.zhin/gateway.db 尚未创建（首次 zhin start 或 zhin console init 时创建，并迁入旧版账号表）' });
  } else {
    const record = inspection.record;
    const settled = record?.status === 'fresh' || record?.status === 'done';
    const lost = inspection.failure?.code === 'store_lost' || inspection.failure?.code === 'store_mismatch'
      || inspection.pendingCode === 'store_lost' || inspection.pendingCode === 'store_mismatch';
    if (lost) {
      results.push({
        name: 'Console 账号存储',
        status: 'error',
        message: `${inspection.failure?.message ?? inspection.pending ?? 'gateway.db 与项目数据库的标记不一致'}`,
        fix: '从备份恢复 .zhin/gateway.db；确认放弃原有账号时：zhin stop && zhin console init --reset-store',
      });
    } else if (inspection.failure) {
      results.push({
        name: 'Console 账号存储',
        status: 'error',
        message: `迁移失败且不会自动重试（${inspection.failure.code}）：${inspection.failure.message}`,
        fix: '按提示处理后重启网关（zhin stop && zhin start）或运行 zhin console migrate',
      });
    } else if (!settled) {
      results.push({
        name: 'Console 账号存储',
        status: 'warn',
        message: `${describeLegacyImport(record)}${inspection.pending ? `：${inspection.pending}` : ''}`,
        fix: options.gatewayRunning ? 'zhin logs 查看网关日志（网关会定时重试）' : 'zhin console migrate（或 zhin start，网关连接时自动迁移）',
      });
    } else if (record?.status === 'done' && record.changed) {
      results.push({
        name: 'Console 账号存储',
        status: 'warn',
        message: `${describeLegacyImport(record)}：确认 gateway.db 里的账号无误后可删除该导出`,
      });
    } else {
      results.push({ name: 'Console 账号存储', status: 'ok', message: `.zhin/gateway.db：${describeLegacyImport(record)}` });
    }
    if (inspection.reappeared?.length) {
      results.push({
        name: '项目库中的旧账号表',
        status: 'warn',
        message: `项目数据库里又出现了 ${inspection.reappeared.join(', ')}（不会被读取；可能是旧版本又运行过）`,
        fix: '确认没有旧版本在运行后删除这些表',
      });
    }
  }

  // ---- restricted Console account (PostgreSQL / MySQL)
  let dialect: string | undefined;
  let configured = false;
  try {
    const config = await projectDatabase();
    dialect = config.dialect;
    configured = Boolean((config as { console?: unknown }).console);
  } catch (error) {
    results.push({ name: 'Console SQL 受限账号', status: 'warn', message: `无法读取数据库配置：${error instanceof Error ? error.message : String(error)}` });
    return results;
  }
  if (dialect === 'pg' || dialect === 'mysql') {
    if (configured) {
      results.push({ name: 'Console SQL 受限账号', status: 'ok', message: '已配置 database.console（实例启动时探测其权限；不合格时原始 SQL 停用）' });
    } else if (options.fix) {
      try {
        const result = await setupConsoleRole({ projectRoot, environment });
        results.push({ name: 'Console SQL 受限账号', status: 'ok', message: describeConsoleRole(result).join(' ') });
      } catch (error) {
        results.push({
          name: 'Console SQL 受限账号',
          status: 'warn',
          message: `未能创建：${error instanceof Error ? error.message : String(error)}`,
          fix: 'zhin db console-role --print-sql 交给 DBA',
        });
      }
    } else {
      results.push({
        name: 'Console SQL 受限账号',
        status: 'warn',
        message: `${dialect === 'pg' ? 'PostgreSQL' : 'MySQL'} 上没有配置 database.console：Console 的原始 SQL 不可用（数据浏览与结构编辑器不受影响）`,
        fix: 'zhin db console-role（或 zhin doctor --fix；无建号权限时 --print-sql）',
      });
    }
  }
  return results;
}
