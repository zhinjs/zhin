import { describe, expect, it, vi } from 'vitest';
import { createMemoryContextRepository, createUserMessage, type AgentMessage } from '@zhin.js/ai';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { registerTurnTrace } from '../../src/trace/turn-trace-registry.js';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import type { ModelExecutionBundle, ModelExecutionScope } from '../../src/model-runtime/types.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { defaultMemorySystem } from '../../src/memory/memory-system.js';
import { AgentCompactionRuntime } from '../../src/memory/compaction-runtime.js';
import { switchActiveLeafWithBranchSummarization } from '../../src/session/branch-summarization-runtime.js';
import { AiCompactionStrategy } from '../../src/memory/ai-compaction-strategy.js';
import { wireMockLlmApi, assistantTextReply } from '../helpers/mock-llm-api.js';

vi.mock('../../src/prompt/assembly.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));
const { runAgentLoopTextTurnRun, collectAgentLoopTurnRun } = await import('../../src/core/agent-core-run.js');

function bundle(llm: ReturnType<typeof wireMockLlmApi>, model: string): ModelExecutionBundle {
  return { provider: llm.provider, llmRuntime: llm.runtime,
    invocation: { model: { model } } as ModelExecutionBundle['invocation'] };
}
async function fixture() {
  const chat = wireMockLlmApi({ name: 'personal-chat', models: ['chat'], responder: () => ({
    ...assistantTextReply('done'), provider: 'personal-chat', model: 'chat',
    usage: { ...assistantTextReply('').usage, input: 10, output: 2, totalTokens: 12 },
  }) });
  chat.runtime.registerProvider('personal-chat', { sdk: 'openai', contextWindow: 8192 }, ['chat']);
  const summary = wireMockLlmApi({ name: 'deployment-summary', models: ['summary'], responder: () => ({
    ...assistantTextReply('Short deployment summary'), provider: 'deployment-summary', model: 'summary',
    usage: { ...assistantTextReply('').usage, input: 30, output: 5, totalTokens: 35 },
  }) });
  summary.runtime.registerProvider('deployment-summary', { sdk: 'openai', contextWindow: 128000 }, ['summary']);
  const models = { chat: bundle(chat, 'chat'), summary: bundle(summary, 'summary'),
    policy: { refs: {}, sources: {} }, release: async () => {} } satisfies ModelExecutionScope;
  const { repository, sessionStore } = createMemoryContextRepository();
  const { session_id: sessionId } = await sessionStore.getOrCreateActive({ session_key: 'personal-session' });
  const messages = [createUserMessage('Old conversation detail. '.repeat(2000)),
    createUserMessage('Another old conversation detail. '.repeat(1000)), createUserMessage('Recent message')];
  await repository.appendMessages(sessionId, messages);
  const host = {
    getTurnProvider: () => chat.provider, llmRuntime: chat.runtime,
    config: { chatModel: 'chat', contextTokens: 8192, compaction: { keepRecentTokens: 100, minKeepCount: 1 },
      maxIterations: 1, toolExecution: 'sequential', outputSchema: false,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 },
    },
    contextRepository: repository, agentSessionStore: sessionStore, compactionRuntime: new AgentCompactionRuntime(),
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  } as unknown as ZhinAgentPrivate;
  return { chat, summary, models, repository, sessionStore, sessionId, host, messages };
}

describe('purpose model integration at summary call boundaries', () => {
  it('automatically compacts with the deployment summary model while retaining chat-window triggers and usage', async () => {
    const f = await fixture();
    const rawBefore = await f.repository.loadMessageRows(f.sessionId);
    const events: TurnEvent[] = [];
    const trace = new TurnTraceCollector({ turnId: 'purpose-summary-trace', sessionKey: 'personal-session' });
    const release = registerTurnTrace(trace);
    const result = await runWithAgentTurnConfiguration({ models: f.models }, () => collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
      host: f.host, sessionId: f.sessionId, rawContent: 'Continue', personaEnhanced: '',
      modelId: 'chat', modelCandidates: ['chat'], allTools: [], resolvedTools: [], toolLoading: 'direct',
      promptProfile: { kind: 'interactive' },
      turnContext: { identity: { turnId: trace.turnId }, origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'user' },
        principal: { subjectId: 'user', roles: ['user'] }, session: { key: 'personal-session' },
        policy: { permissions: ['user'], unattended: false } },
    } as never), event => { events.push(event); trace.record(event); })).finally(release);
    expect(f.summary.calls).toHaveLength(1);
    expect(f.summary.calls[0]!.model.id).toBe('summary');
    expect(f.chat.calls).toHaveLength(1);
    expect(f.chat.calls[0]!.model.id).toBe('chat');
    expect(result.usage).toEqual({ prompt_tokens: 40, completion_tokens: 7, total_tokens: 47 });
    expect(events.filter(event => event.type === 'usage')).toHaveLength(2);
    expect(trace.snapshot().requests?.map(request => [request.provider, request.model])).toEqual([
      ['deployment-summary', 'summary'], ['personal-chat', 'chat'],
    ]);
    expect(events.filter(event => event.type === 'usage')).toContainEqual(expect.objectContaining({ model: 'summary', provider: 'deployment-summary' }));
    expect(await f.repository.loadMessageRows(f.sessionId)).toEqual(rawBefore);
    expect(JSON.stringify((await f.repository.loadContext(f.sessionId)).messages)).toContain('Short deployment summary');
  });

  it('manual compaction uses the summary lease without replacing the chat retention budget', async () => {
    const f = await fixture();
    const compact = vi.spyOn(f.host.compactionRuntime, 'compactSession');
    const result = await runWithAgentTurnConfiguration({ models: f.models }, () => defaultMemorySystem.compactSession(
      f.host, 'personal-session', { agentSessionStore: f.sessionStore, contextRepository: f.repository }));
    expect(result.ok).toBe(true);
    expect(f.summary.calls).toHaveLength(1);
    expect(f.chat.calls).toHaveLength(0);
    expect(compact).toHaveBeenCalledWith(f.repository, expect.objectContaining({
      model: expect.objectContaining({ id: 'summary', contextWindow: 128000 }), contextWindow: 8192,
    }));
  });

  it('branch switching summarizes through the summary lease and preserves the original rows', async () => {
    const f = await fixture();
    const rows = await f.repository.loadMessageRows(f.sessionId);
    const firstId = rows[0]!.id!;
    await runWithAgentTurnConfiguration({ models: f.models }, () => switchActiveLeafWithBranchSummarization(
      f.host, f.sessionId, firstId, { compactionConfig: { keepRecentTokens: 1 } }));
    expect(f.summary.calls).toHaveLength(1);
    expect(f.chat.calls).toHaveLength(0);
    expect(await f.repository.hasBranchSummary(f.sessionId, firstId)).toBe(true);
    expect(await f.repository.loadMessageRows(f.sessionId)).toEqual(rows);
    expect((await f.sessionStore.getBySessionId(f.sessionId))!.active_leaf_message_id).toBe(firstId);
  });

  it('strategy-based compaction also consumes the fixed summary lease', async () => {
    const f = await fixture();
    const strategy = new AiCompactionStrategy(f.chat.runtime, f.chat.runtime.model('personal-chat', 'chat'), { keepRecentTokens: 1, minKeepCount: 1 });
    const result = await runWithAgentTurnConfiguration({ models: f.models }, () => strategy.compact({ messages: f.messages, contextWindow: 8192 }));
    expect(f.summary.calls).toHaveLength(1);
    expect(f.chat.calls).toHaveLength(0);
    expect(JSON.stringify(result.messages)).toContain('Short deployment summary');
  });

  it('retains legacy embedder behavior without a model scope', async () => {
    const f = await fixture();
    const result = await defaultMemorySystem.compactSession(f.host, 'personal-session', { agentSessionStore: f.sessionStore, contextRepository: f.repository });
    expect(result.ok).toBe(true);
    expect(f.chat.calls).toHaveLength(1);
    expect(f.summary.calls).toHaveLength(0);
  });
});
