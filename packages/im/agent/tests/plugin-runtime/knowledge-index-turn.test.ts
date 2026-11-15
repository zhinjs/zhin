import { createUserMessage } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { UsageQuota } from '../../src/security/usage-quota.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { AgentTurnExecutionContext } from '../../src/plugin-runtime/agent-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import type { KnowledgeIndex } from '../../src/plugin-runtime/native-knowledge-tool.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import type { PromptSegment } from '../../src/prompt/segments/types.js';

/** #1250 b27: the knowledge base index reaches the turn's system prompt segments. */
async function promptSegmentsFor(tools: readonly ToolCapability[], index: KnowledgeIndex, text = '怎么给这个机器人添加新知识？') {
  const owner = rootPluginId();
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'account', scope: 'group', sceneId: 'group', messageId: 'message' },
    principal: { subjectId: 'sender', roles: [] }, input: { text },
    session: { key: 'session' }, policy: { permissions: [], unattended: false },
    capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => undefined } },
  });
  let segments: readonly PromptSegment[] = [];
  const core = { runText(input: { promptRuntime: { segments: readonly PromptSegment[] } }) {
    segments = input.promptRuntime.segments;
    return (async function* () {
      yield { type: 'turn_end' as const, output: [{ type: 'text' as const, content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return { reply: 'done', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        path: 'agent' as const, iterations: 1, model: 'chat', toolCalls: [] };
    })();
  } };
  const host = {
    emitter: new ZhinAgentEventEmitter(new AgentEventBus()), config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) },
    usageQuota: new UsageQuota(), promptController: new PromptController('one-at-a-time', 'one-at-a-time'),
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }),
      setDeferredToolSnapshot: async () => undefined }, finalizeActiveTurn: async () => undefined,
  };
  const sessionSystem = { prepareIngressTurn: async () => ({ sessionKey: 'session', sessionId: 'session', userId: 'sender',
    isNewSession: false, turnUser: { rawContent: text, promptMessages: [] } }), touchAfterTurn: async () => undefined };
  const buildContext = async () => ({ userMessages: [createUserMessage(text)],
    personaEnhanced: 'persona', modelCandidates: ['chat'], modelId: 'chat', turnEnvelope: null });
  const context: AgentTurnExecutionContext = {
    turn, capabilities: { owner, generation: 1, tools, agents: [], mcp: [], promptSections: [], skills: [] },
    toolCapabilities: tools, tools: new TurnToolRuntime(turn, tools),
    selection: { binding: { name: 'zhin', providerAlias: 'chat', model: 'chat', mcpServers: [] }, mcpServers: [] },
  };
  const engine = createFullAgentTurnEngine({ host: host as never, core: core as never, knowledgeIndex: index,
    sessionSystem: sessionSystem as never, contextSystem: { buildTextTurnContext: buildContext } as never });
  for await (const event of engine.run(context)) expect(event.type).toBe('turn_end');
  return segments;
}

const knowledgeTool: ToolCapability = {
  owner: rootPluginId(), name: 'knowledge_search', qualifiedName: 'knowledge_search', description: 'Search the knowledge base',
  inputSchema: { type: 'object' }, source: 'builtin:knowledge', execute: async () => undefined as never,
};

const index: KnowledgeIndex = {
  search: async () => ({ status: 'ready', indexedChunks: 0, matches: [] }),
  outline: async () => ({ status: 'ready', files: [{ source: 'faq.md', headings: [
    { level: 1, text: '常见问题' }, { level: 2, text: '如何添加新知识' },
  ] }] }),
};

it('adds the knowledge base index to the cached prompt prefix while knowledge_search is available', async () => {
  const segments = await promptSegmentsFor([knowledgeTool], index);
  const segment = segments.find(entry => entry.id === '§11b_knowledge_index');
  expect(segment?.kind).toBe('platform');
  const text = segment?.inject({ history: [], runtime: {}, session: { sessionKey: 'session' } }) as string;
  expect(text).toContain('- faq.md: 常见问题 — 如何添加新知识');
  expect(text).toContain('call knowledge_search first');
});

it('leaves the index out when the turn cannot call knowledge_search', async () => {
  const segments = await promptSegmentsFor([], index);
  expect(segments.some(entry => entry.id === '§11b_knowledge_index')).toBe(false);
});
