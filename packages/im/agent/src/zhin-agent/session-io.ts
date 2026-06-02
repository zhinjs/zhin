import type { ChatMessage } from '@zhin.js/ai';
import type { ConversationMemory, SessionManager, ContextManager } from '@zhin.js/ai';

export interface SessionIODeps {
  memory: ConversationMemory;
  sessions: SessionManager;
  contextManager: ContextManager | null;
}

export async function buildHistoryMessages(
  memory: ConversationMemory,
  sessionId: string,
): Promise<ChatMessage[]> {
  return memory.buildContext(sessionId);
}

export async function saveToSession(
  deps: SessionIODeps,
  sessionId: string,
  userContent: string,
  assistantContent: string,
  sceneId?: string,
): Promise<boolean> {
  const isNewSession = !(await deps.sessions.has(sessionId));
  await deps.memory.saveRound(sessionId, userContent, assistantContent);
  await deps.sessions.addMessage(sessionId, { role: 'user', content: userContent });
  await deps.sessions.addMessage(sessionId, { role: 'assistant', content: assistantContent });
  if (deps.contextManager && sceneId) {
    deps.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
  }
  return isNewSession;
}