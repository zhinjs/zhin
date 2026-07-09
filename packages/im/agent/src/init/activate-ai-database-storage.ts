/**
 * Wire agent_* / im_transcripts stores into ZhinAgent (ADR 0009).
 */
import { type AIConfig, AgentSessionStore, DatabaseContextRepository, DatabaseImTranscriptStore, DatabaseMemoryEntryRepository, InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT } from '../context/context-tail-limit.js';
import { setMemoryEntryRepository } from '../memory-entry-registry.js';
import {
  DatabaseOrchestrationRepository,
  MemoryOrchestrationRepository,
} from '../orchestrator/orchestration-repository.js';
import { upgradeOrchestrationRepository } from '../orchestrator/orchestration-service.js';
import type { AIServiceRefs } from './shared-refs.js';
import { wireCollaborationStorage } from '../collaboration/wire-collaboration-storage.js';
export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
  collaborationRaw?: unknown,
): Promise<void> {
  if (!refs.zhinAgent) return;
  if (config.sessions?.useDatabase === false) return;

  const agentSessionModel = db.models?.get('agent_sessions');
  const agentMessageModel = db.models?.get('agent_messages');
  const agentSummaryModel = db.models?.get('agent_summaries');
  const imTranscriptModel = db.models?.get('im_transcripts');

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

  const imTranscriptStore = imTranscriptModel
    ? new DatabaseImTranscriptStore(imTranscriptModel, {
      searchMaxAgeMs: config.sessions?.coldStartMaxAgeMs,
    })
    : undefined;

  refs.zhinAgent.configure({
    agentSessionStore,
    contextRepository,
    imTranscriptStore,
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
  upgradeOrchestrationRepository(orchRepo);

  const semanticEnabled = config.memory?.semantic?.enabled === true;
  if (semanticEnabled) {
    const memoryModel = db.models?.get('memory_entries');
    const memoryRepo = memoryModel
      ? new DatabaseMemoryEntryRepository(memoryModel as ConstructorParameters<typeof DatabaseMemoryEntryRepository>[0])
      : new InMemoryMemoryEntryRepository();
    setMemoryEntryRepository(memoryRepo);
  } else {
    setMemoryEntryRepository(null);
  }

  await wireCollaborationStorage(db, collaborationRaw);
}
