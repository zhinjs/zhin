/**
 * Wire agent session stores into ZhinAgent.
 */
import {
  type AIConfig,
  AgentSessionStore,
  DatabaseContextRepository,
  DatabaseMemoryEntryRepository,
  ensureMemoryEntryColumns,
} from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from '../context/context-tail-limit.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import { AI_DECISION_EVENTS_TABLE } from '../decision-events.js';
import { AI_SCENE_MEMBERS_TABLE } from '../scene-facts.js';
import { AI_CONTROL_STATE_TABLE } from '../control-plane.js';
import { AI_SESSION_OPS_TABLE } from '../session-ops.js';
import { AI_ANNOUNCEMENTS_TABLE } from '../announcements.js';
import { AI_GROUP_RULES_TABLE } from '../group-rules.js';
import { AI_SESSION_EVENTS_TABLE } from '../session-events.js';

export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
  semanticMemory: SemanticMemoryRuntime | null,
): Promise<void> {
  if (!refs.zhinAgent) throw new Error('Agent database activation requires a ZhinAgent instance');
  if (config.sessions?.useDatabase === false) return;

  const agentSessionModel = requireDatabaseModel<ConstructorParameters<typeof AgentSessionStore>[0]>(
    db,
    'agent_sessions',
  );
  const agentMessageModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseContextRepository>[0]>(
    db,
    'agent_messages',
  );
  const agentSummaryModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseContextRepository>[1]>(
    db,
    'agent_summaries',
  );
  const semanticEnabled = config.memory?.semantic?.enabled === true;
  if (semanticEnabled && !semanticMemory) {
    throw new Error('Semantic memory runtime was not prepared');
  }
  let semanticActivation: { runtime: SemanticMemoryRuntime; repository: DatabaseMemoryEntryRepository } | undefined;
  if (semanticEnabled && semanticMemory) {
    const memoryEntryModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseMemoryEntryRepository>[0]>(
      db,
      'memory_entries',
    );
    // Tables created before #733 gain the new columns; existing rows are kept.
    await ensureMemoryEntryColumns(db, memoryEntryModel);
    semanticActivation = { runtime: semanticMemory, repository: new DatabaseMemoryEntryRepository(memoryEntryModel) };
  }

  const agentSessionStore = new AgentSessionStore(agentSessionModel, {
    sessionIdleArchiveMs: config.sessions?.sessionIdleArchiveMs,
  });
  const contextRepository = new DatabaseContextRepository(
    agentMessageModel,
    agentSummaryModel,
    agentSessionStore,
    { tailMessageLimit: config.sessions?.coldStartMaxMessages ?? DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT },
  );
  refs.zhinAgent.configure({
    agentSessionStore,
    contextRepository,
  });

  const profileModel = db.models?.get('ai_user_profiles');
  const relationModel = db.models?.get('ai_user_relations');
  const sessionModel = db.models?.get('ai_session_profiles');
  const sceneMemberModel = db.models?.get(AI_SCENE_MEMBERS_TABLE);
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel, relationModel, sessionModel, sceneMemberModel);
  }
  const decisionModel = db.models?.get(AI_DECISION_EVENTS_TABLE);
  if (decisionModel) refs.zhinAgent.getDecisionEvents?.().upgradeToDatabase(decisionModel);
  // ADR 0036 slice D: 读不出持久化开关时不抛错，控制面 fail closed 并稍后重试。
  const controlModel = db.models?.get(AI_CONTROL_STATE_TABLE);
  if (controlModel) await refs.zhinAgent.getControlPlane?.().upgradeToDatabase(controlModel);
  // ADR 0037 slice A: 读不出会话运营配置时不抛错，欢迎一律不发并稍后重试。
  const sessionOpsModel = db.models?.get(AI_SESSION_OPS_TABLE);
  if (sessionOpsModel) await refs.zhinAgent.getSessionOps?.().upgradeToDatabase(sessionOpsModel);
  // ADR 0037 slice B: 公告草稿 / 审批 / 发送状态以表为准。
  const announcementsModel = db.models?.get(AI_ANNOUNCEMENTS_TABLE);
  if (announcementsModel) await refs.zhinAgent.getAnnouncements?.().upgradeToDatabase(announcementsModel);
  // ADR 0037 slice D: 会话日程以表为准；接表后调度方重新排期（重启后的宕机补偿从这里开始）。
  const sessionEventsModel = db.models?.get(AI_SESSION_EVENTS_TABLE);
  if (sessionEventsModel) await refs.zhinAgent.getSessionEvents?.().upgradeToDatabase(sessionEventsModel);
  // ADR 0039 slice A: 动态群管规则以表为准。
  const groupRulesModel = db.models?.get(AI_GROUP_RULES_TABLE);
  if (groupRulesModel) await refs.zhinAgent.getGroupRules?.().upgradeToDatabase(groupRulesModel);

  if (semanticActivation) {
    semanticActivation.runtime.activate(semanticActivation.repository);
    refs.zhinAgent.configure({ semanticMemory: semanticActivation.runtime });
  }
}

function requireDatabaseModel<T>(
  db: { models?: { get(name: string): unknown } },
  name: string,
): T {
  const model = db.models?.get(name) as T | undefined;
  if (!model) throw new Error(`Agent database activation requires the ${name} model`);
  return model;
}
