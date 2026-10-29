import { getLogger } from '@zhin.js/logger';
import { ensureDatabaseColumns, ensureDatabaseIndex, type StructuredDatabase } from '@zhin.js/database';
import { databaseRootHostToken } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { AGENT_MESSAGE_QUERY_MODEL, AGENT_SESSION_SOURCE_MODEL, agentMessageQueryFields, parseAgentMessageRow } from '@zhin.js/ai';
import { defineAiDatabaseModels, activateAiDatabaseStorage, AGENT_USAGE_TURN_MODEL, AGENT_USAGE_CALL_MODEL,
  DatabaseAgentUsageStore, agentUsageStoreToken, DatabaseScheduleJobStorage, SCHEDULE_JOB_MODEL, SCHEDULE_JOB_MIGRATION_MODEL,
  AI_DECISION_EVENTS_TABLE, DEFAULT_DECISION_AUDIT_RETENTION_DAYS, DEFAULT_GROUP_RULE_RETENTION_DAYS } from '@zhin.js/agent/runtime';
import type { AgentRuntimeFoundation } from './runtime-foundation.js';
import type { AgentHostAIConfig } from './config.js';

type Context = Parameters<RootResourceInstaller>[0];

/** Agent owns its storage with or without the optional Workroom package. */
export function installAgentPersistence(context: Pick<Context, 'resources' | 'handoff' | 'lifecycle' | 'admission'>,
  foundation: AgentRuntimeFoundation, config: AgentHostAIConfig, pruneTraces?: () => Promise<unknown>): void {
  const { resources, handoff, lifecycle, admission } = context;
  const database = resources.has(databaseRootHostToken) ? resources.use(databaseRootHostToken) : undefined;
  const sessionsInDatabase = config.sessions?.useDatabase !== false;
  if (sessionsInDatabase && !database) throw new Error('ai.sessions.useDatabase requires the Database Root Host');
  if (!sessionsInDatabase && foundation.semanticMemory) throw new Error('ai.memory.semantic.enabled requires the Database Root Host');
  if (sessionsInDatabase) defineAiDatabaseModels((name, definition) => database!.define(name, definition));
  const sql = database && ['sqlite', 'mysql', 'pg'].includes(database.dialect);
  let usage: DatabaseAgentUsageStore | undefined;
  // ADR 0036 slice C: `ai.audit.retentionDays` (default 14) for `ai_decision_events`.
  const auditRetentionDays = Number(config.audit?.retentionDays ?? DEFAULT_DECISION_AUDIT_RETENTION_DAYS);
  if (!Number.isSafeInteger(auditRetentionDays) || auditRetentionDays <= 0) throw new TypeError('ai.audit.retentionDays must be a positive integer');
  const decisions = () => {
    const log = foundation.agent.getDecisionEvents?.();
    return log?.persistent ? log : undefined;
  };
  // ADR 0039 slice A: 终态群管规则按保留期 / 每群条数清理（启动 + 每小时）；失败只记日志。
  const pruneGroupRules = async () => {
    const rules = foundation.agent.getGroupRules?.();
    if (!rules?.persistent) return;
    await rules.prune(DEFAULT_GROUP_RULE_RETENTION_DAYS).catch(() => {
      getLogger('agent').warn('op=group_rule_prune status=failed; 群管规则保留期清理失败');
    });
  };
  if (sql) {
    database.define('agent_schedule_jobs', SCHEDULE_JOB_MODEL, { addColumns: ['locale'] });
    database.define('agent_schedule_migration', SCHEDULE_JOB_MIGRATION_MODEL);
    database.define('agent_usage_turns', AGENT_USAGE_TURN_MODEL);
    database.define('agent_usage_calls', AGENT_USAGE_CALL_MODEL);
    usage = new DatabaseAgentUsageStore(database, Number(config.usage?.retentionDays ?? 30));
    resources.provide(agentUsageStoreToken, usage);
  } else {
    getLogger('agent').warn('op=structured_storage status=unsupported; 结构化用量与任务存储需要 SQLite、MySQL 或 PostgreSQL');
  }
  if (!sessionsInDatabase) foundation.agent.markMemoryPersistenceReady();
  // Register cleanup during setup — root lifecycle is sealed before activateNext runs.
  let stopped = false;
  let pendingPrune: Promise<void> | undefined;
  let pendingStart: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let off = () => {};
  const pruneTraceArchive = async () => {
    try { await pruneTraces?.(); }
    catch { getLogger('agent').warn('op=trace_prune status=failed; 轨迹保留期清理失败'); }
  };
  lifecycle.add(async () => {
    stopped = true;
    off();
    if (timer) clearInterval(timer);
    await pendingStart;
    await pendingPrune;
  });
  handoff.add({ activateNext: async signal => {
    signal.throwIfAborted();
    const raw = database?.getRawDatabase() as StructuredDatabase | undefined;
    if (sessionsInDatabase) {
      if (!raw) throw new Error('Agent persistence requires an active database connection');
      if (sql) await migrateAgentQueryColumns(raw);
      await activateAiDatabaseStorage(raw, { aiService: foundation.service, zhinAgent: foundation.agent }, config, foundation.semanticMemory);
      foundation.agent.markMemoryPersistenceReady();
    }
    if (sql) await foundation.schedule.store.activateDatabase(new DatabaseScheduleJobStorage(database));
    if (sql && raw && decisions()) {
      await ensureDatabaseIndex(raw, AI_DECISION_EVENTS_TABLE, 'ai_decision_events_ts', [{ name: 'ts' }]);
      await ensureDatabaseIndex(raw, AI_DECISION_EVENTS_TABLE, 'ai_decision_events_turn', [{ name: 'turn_id', text: true }, { name: 'ts' }]);
    }
    await decisions()?.prune(auditRetentionDays);
    await pruneGroupRules();
    if (usage && raw) {
      await usage.prune();
      await ensureDatabaseIndex(raw, 'agent_usage_turns', 'agent_usage_turns_ended', [{ name: 'ended_at' }]);
      await ensureDatabaseIndex(raw, 'agent_usage_calls', 'agent_usage_calls_root', [{ name: 'root_id' }]);
      await ensureDatabaseIndex(raw, 'agent_usage_calls', 'agent_usage_calls_ended', [{ name: 'root_ended_at' }]);
    }
    signal.throwIfAborted();
    off = admission.onActivate(() => {
      if (stopped) return;
      // Timers only become live after the fully migrated generation is published.
      pendingStart = foundation.schedule.start().catch(() => {
        getLogger('agent').warn('op=schedule_start status=failed; 定时任务启动失败');
      });
      // Diagnostic storage must not delay generation publication or Agent admission.
      pendingPrune = pruneTraceArchive().finally(() => { pendingPrune = undefined; });
      if (usage || decisions() || pruneTraces || foundation.agent.getGroupRules?.()?.persistent) {
        timer = setInterval(() => {
          if (stopped || pendingPrune) return;
          pendingPrune = Promise.all([
            usage?.prune().catch(() => {
              getLogger('agent').warn('op=usage_prune status=failed; 用量保留期清理失败');
            }),
            // Never rejects for database errors (only logs); see DecisionEventLog.prune.
            decisions()?.prune(auditRetentionDays),
            pruneTraceArchive(),
            pruneGroupRules(),
          ]).then(() => undefined).finally(() => { pendingPrune = undefined; });
        }, 3_600_000);
        timer.unref();
      }
    });
  } });
}

async function migrateAgentQueryColumns(database: StructuredDatabase): Promise<void> {
  await ensureDatabaseColumns(database, 'agent_sessions', AGENT_SESSION_SOURCE_MODEL);
  await ensureDatabaseColumns(database, 'agent_messages', AGENT_MESSAGE_QUERY_MODEL);
  const messages = database.models.get('agent_messages')!;
  while (true) {
    const rows = await messages.select('id', 'payload', 'timestamp').where({ query_version: null }).orderBy('id').limit(200);
    if (!rows.length) break;
    for (const row of rows) {
      const message = parseAgentMessageRow(row as never);
      if (!message) throw new Error(`Cannot migrate malformed agent message ${String(row.id)}`);
      await messages.update(agentMessageQueryFields(message)).where({ id: row.id, query_version: null });
    }
  }
  await ensureDatabaseIndex(database, 'agent_sessions', 'agent_sessions_key_status_time', [{ name: 'session_key', text: true }, { name: 'status', text: true }, { name: 'updated_at' }]);
  await ensureDatabaseIndex(database, 'agent_messages', 'agent_messages_session_time', [{ name: 'session_id', text: true }, { name: 'timestamp' }]);
  await ensureDatabaseIndex(database, 'agent_messages', 'agent_messages_actor_time', [{ name: 'actor_id', text: true }, { name: 'timestamp' }]);
}
