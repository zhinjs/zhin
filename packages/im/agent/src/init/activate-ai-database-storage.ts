/**
 * Wire agent_* / im_transcripts stores into ZhinAgent (ADR 0009).
 */
import type { AIConfig } from '@zhin.js/core';
import {
  AgentSessionStore,
  DatabaseContextRepository,
  DatabaseImTranscriptStore,
} from '@zhin.js/ai';
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
    refs.zhinAgent.setAgentSessionStore(agentSessionStore);
  }

  if (agentMessageModel && agentSummaryModel && agentSessionStore) {
    refs.zhinAgent.setContextRepository(
      new DatabaseContextRepository(
        agentMessageModel,
        agentSummaryModel,
        agentSessionStore,
        { tailMessageLimit: config.sessions?.coldStartMaxMessages },
      ),
    );
  }

  if (imTranscriptModel) {
    refs.zhinAgent.setImTranscriptStore(new DatabaseImTranscriptStore(imTranscriptModel, {
      searchMaxAgeMs: config.sessions?.coldStartMaxAgeMs,
    }));
  }

  const profileModel = db.models?.get('ai_user_profiles');
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel);
  }
}
