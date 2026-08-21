/**
 * Wire agent session stores into ZhinAgent.
 */
import { type AIConfig, AgentSessionStore, DatabaseContextRepository, DatabaseMemoryEntryRepository } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from '../context/context-tail-limit.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  type WorkroomJournalPayloadPort,
} from '../workroom/journal.js';
import { ActivatableWorkroomCatalog, DatabaseWorkroomCatalog } from '../workroom/catalog.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import {
  upgradeAgentSessionTreeData,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';

export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
  workroomJournal: ActivatableWorkroomJournal,
  workroomJournalPayloads: WorkroomJournalPayloadPort,
  workroomCatalog: ActivatableWorkroomCatalog,
  semanticMemory: SemanticMemoryRuntime | null,
): Promise<void> {
  if (!refs.zhinAgent) throw new Error('Agent database activation requires a ZhinAgent instance');
  if (config.sessions?.useDatabase === false) return;

  await upgradeAgentSessionTreeData(db as AgentDbQueryable);

  const agentSessionModel = db.models?.get('agent_sessions');
  const agentMessageModel = db.models?.get('agent_messages');
  const agentSummaryModel = db.models?.get('agent_summaries');

  let agentSessionStore: AgentSessionStore | undefined;
  if (agentSessionModel) {
    agentSessionStore = new AgentSessionStore(agentSessionModel, {
      sessionIdleArchiveMs: config.sessions?.sessionIdleArchiveMs,
    });
  }

  const contextRepository = (agentMessageModel && agentSummaryModel && agentSessionStore)
    ? new DatabaseContextRepository(
        agentMessageModel,
        agentSummaryModel,
        agentSessionStore,
        { tailMessageLimit: config.sessions?.coldStartMaxMessages ?? DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT },
      )
    : undefined;

  refs.zhinAgent.configure({
    agentSessionStore,
    contextRepository,
  });

  const profileModel = db.models?.get('ai_user_profiles');
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel);
  }

  const semanticEnabled = config.memory?.semantic?.enabled === true;
  if (semanticEnabled) {
    if (!semanticMemory) throw new Error('Semantic memory runtime was not prepared');
    const memoryModel = db.models?.get('memory_entries');
    if (!memoryModel) throw new Error('Semantic memory requires the memory_entries database model');
    semanticMemory.activate(new DatabaseMemoryEntryRepository(
      memoryModel as ConstructorParameters<typeof DatabaseMemoryEntryRepository>[0],
    ));
  }

  const workroomEventModel = db.models?.get('workroom_events');
  if (!workroomEventModel) throw new Error('Workroom requires the workroom_events database model');
  const databaseWorkroomJournal = new DatabaseWorkroomJournal(
    db,
    workroomEventModel,
    workroomJournalPayloads,
  );
  // Validate every persisted row before publishing the production writer latch.
  // Old unsigned v2 rows remain offline migration candidates and never become active state.
  await databaseWorkroomJournal.scanStoredHeaders();
  workroomJournal.activate(databaseWorkroomJournal);
  const workroomCatalogModel = db.models?.get('workroom_catalog');
  if (!workroomCatalogModel) throw new Error('Workroom requires the workroom_catalog database model');
  workroomCatalog.activate(new DatabaseWorkroomCatalog(db, workroomCatalogModel));
}
