/**
 * Wire agent_* / im_transcripts stores into ZhinAgent (ADR 0009).
 */
import type { AIConfig } from '@zhin.js/ai';
import {
  AgentSessionStore,
  DatabaseContextRepository,
  DatabaseImTranscriptStore,
  DatabaseMemoryEntryRepository,
  InMemoryMemoryEntryRepository,
} from '@zhin.js/ai';
import { setMemoryEntryRepository } from '../memory-entry-registry.js';
import {
  DatabaseOrchestrationRepository,
  MemoryOrchestrationRepository,
} from '../orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../orchestrator/orchestration-service.js';
import {
  createOrchestrationRuntimeFromService,
  setOrchestrationRuntime,
} from '../orchestration-runtime-registry.js';
import type { AIServiceRefs } from './shared-refs.js';

export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
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
        { tailMessageLimit: config.sessions?.coldStartMaxMessages },
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
  const orchRepo = runModel && taskModel
    ? new DatabaseOrchestrationRepository(runModel, taskModel)
    : new MemoryOrchestrationRepository();
  const orchService = initOrchestrationService(orchRepo);
  setOrchestrationRuntime(createOrchestrationRuntimeFromService(orchService));

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
}
