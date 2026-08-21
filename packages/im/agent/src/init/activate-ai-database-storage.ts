/**
 * Wire agent session stores into ZhinAgent.
 */
import { type AIConfig, AgentSessionStore, DatabaseContextRepository, DatabaseMemoryEntryRepository } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from '../context/context-tail-limit.js';
import type { SemanticMemoryRuntime } from '../plugin-runtime/native-semantic-memory-tools.js';
import {
  DatabaseOrchestrationRepository,
  MemoryOrchestrationRepository,
} from '../orchestrator/orchestration-repository.js';
import {
  upgradeOrchestrationRepository,
  type OrchestrationService,
} from '../orchestrator/orchestration-service.js';
import type { AIServiceRefs } from '../internal/ai-service-refs.js';
import {
  upgradeAgentSessionTreeData,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';

export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
  orchestrationService: OrchestrationService,
  semanticMemory: SemanticMemoryRuntime | null,
): Promise<void> {
  if (!refs.zhinAgent) return;
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

  const runModel = db.models?.get('orchestration_runs');
  const taskModel = db.models?.get('orchestration_tasks');
  const eventModel = db.models?.get('orchestration_events');
  const orchRepo = runModel && taskModel
    ? new DatabaseOrchestrationRepository(runModel, taskModel, eventModel)
    : new MemoryOrchestrationRepository();
  // Upgrade the existing kernel's repository in-place. The kernel was already
  // initialised with a Memory placeholder during create-zhinAgent; this swaps
  // it to the Database repository while preserving registered executors and
  // workflow strategies (ADR 0027 — single state-transition authority).
  upgradeOrchestrationRepository(orchRepo, orchestrationService);

  const semanticEnabled = config.memory?.semantic?.enabled === true;
  if (semanticEnabled) {
    if (!semanticMemory) throw new Error('Semantic memory runtime was not prepared');
    const memoryModel = db.models?.get('memory_entries');
    if (!memoryModel) throw new Error('Semantic memory requires the memory_entries database model');
    semanticMemory.activate(new DatabaseMemoryEntryRepository(
      memoryModel as ConstructorParameters<typeof DatabaseMemoryEntryRepository>[0],
    ));
  }
}
