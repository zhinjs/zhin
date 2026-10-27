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
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel, relationModel);
  }

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
