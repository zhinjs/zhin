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
} from '../workroom/journal/index.js';
import { ActivatableWorkroomCatalog, DatabaseWorkroomCatalog } from '../workroom/catalog.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';

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
  const workroomEventModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseWorkroomJournal>[1]>(
    db,
    'workroom_events',
  );
  const workroomCatalogModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseWorkroomCatalog>[1]>(
    db,
    'workroom_catalog',
  );
  const semanticEnabled = config.memory?.semantic?.enabled === true;
  if (semanticEnabled && !semanticMemory) {
    throw new Error('Semantic memory runtime was not prepared');
  }
  const semanticActivation = semanticEnabled && semanticMemory
    ? {
        runtime: semanticMemory,
        repository: new DatabaseMemoryEntryRepository(
          requireDatabaseModel<ConstructorParameters<typeof DatabaseMemoryEntryRepository>[0]>(
            db,
            'memory_entries',
          ),
        ),
      }
    : undefined;

  const agentSessionStore = new AgentSessionStore(agentSessionModel, {
    sessionIdleArchiveMs: config.sessions?.sessionIdleArchiveMs,
  });
  const contextRepository = new DatabaseContextRepository(
    agentMessageModel,
    agentSummaryModel,
    agentSessionStore,
    { tailMessageLimit: config.sessions?.coldStartMaxMessages ?? DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT },
  );
  const databaseWorkroomJournal = new DatabaseWorkroomJournal(
    db,
    workroomEventModel,
    workroomJournalPayloads,
  );
  // Validate persisted authority before mutating any candidate runtime port.
  await databaseWorkroomJournal.scanStoredHeaders();

  refs.zhinAgent.configure({
    agentSessionStore,
    contextRepository,
  });

  const profileModel = db.models?.get('ai_user_profiles');
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel);
  }

  semanticActivation?.runtime.activate(semanticActivation.repository);

  workroomJournal.activate(databaseWorkroomJournal);
  workroomCatalog.activate(new DatabaseWorkroomCatalog(db, workroomCatalogModel));
}

function requireDatabaseModel<T>(
  db: { models?: { get(name: string): unknown } },
  name: string,
): T {
  const model = db.models?.get(name) as T | undefined;
  if (!model) throw new Error(`Agent database activation requires the ${name} model`);
  return model;
}
