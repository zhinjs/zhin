import { createUserMessage, type AgentTool, type DecisionProvider } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { AgentTurnExecutionContext } from '../../src/plugin-runtime/agent-runtime.js';
import { createFullAgentTurnEngine } from '../../src/plugin-runtime/full-agent-turn-engine.js';
import { PromptController } from '../../src/turn/prompt-controller.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';

it('awaits authorized Jev Skill activation before prompt assembly and AgentCore execution', async () => {
  const owner = rootPluginId();
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'account', scope: 'group', sceneId: 'group', messageId: 'message' },
    principal: { subjectId: 'sender', roles: ['admin'] }, input: { text: 'restrict this member' },
    session: { key: 'session' }, policy: { permissions: ['admin'], unattended: false },
    capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => undefined } },
  });
  const privateTool: ToolCapability = {
    owner, name: 'admin__mute', qualifiedName: 'admin__mute', description: 'Mute a member',
    hidden: true, placement: { kind: 'agent-skill', agent: 'icqq', skill: 'admin' },
    inputSchema: { type: 'object' }, source: '/agents/icqq/skills/admin/tools/mute/index.ts',
    execute: async () => undefined as never,
  };
  const persisted = vi.fn(async () => undefined);
  const buildContext = vi.fn(async () => ({ userMessages: [createUserMessage(turn.input.text ?? '')],
    personaEnhanced: 'persona', modelCandidates: ['chat'], modelId: 'chat', turnEnvelope: null }));
  let resolved: readonly AgentTool[] = [];
  const core = { runText(input: { resolvedTools: readonly AgentTool[] }) {
    resolved = input.resolvedTools;
    return (async function* () {
      yield { type: 'turn_end' as const, output: [{ type: 'text' as const, content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return { reply: 'done', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        path: 'agent' as const, iterations: 1, model: 'chat', toolCalls: [] };
    })();
  } };
  const host = {
    emitter: new ZhinAgentEventEmitter(new AgentEventBus()), config: { deferredTools: {} },
    rateLimiter: { check: () => ({ allowed: true }) }, promptController: new PromptController('one-at-a-time', 'one-at-a-time'),
    contextRepository: { getDeferredToolSnapshot: async () => ({ loadedTools: {}, loadedSkills: [] }),
      setDeferredToolSnapshot: persisted }, finalizeActiveTurn: async () => undefined,
  };
  const sessionSystem = { prepareIngressTurn: async () => ({ sessionKey: 'session', sessionId: 'session', userId: 'sender',
    isNewSession: false, turnUser: { rawContent: turn.input.text ?? '', promptMessages: [] } }), touchAfterTurn: async () => undefined };
  const provider: DecisionProvider = { evaluate: vi.fn(async () => ({ model: 'jev',
    answers: { candidate_0: { type: 'score', score: 0.9, confidence: 0.9, legend: {}, probabilities: {} } },
    usage: { inputTokens: 1, outputTokens: 1 } })) as DecisionProvider['evaluate'] };
  const context: AgentTurnExecutionContext = {
    turn, capabilities: { owner, generation: 1, tools: [privateTool], agents: [], mcp: [], promptSections: [],
      skills: [{ $feature: 'zhin.skill/1', owner, name: 'admin', qualifiedName: 'admin', agentName: 'icqq',
        description: 'Group administration', instructions: 'Confirm duration before muting.', toolNames: ['mute'],
        source: '/agents/icqq/skills/admin/SKILL.md' }] },
    toolCapabilities: [privateTool], tools: new TurnToolRuntime(turn, [privateTool]),
    selection: { binding: { name: 'zhin', providerAlias: 'chat', model: 'chat', mcpServers: [] }, mcpServers: [] },
    decision: { provider, config: { provider: 'root/typesafe', skills: { mode: 'active' } } },
  };
  const engine = createFullAgentTurnEngine({ host: host as never, core: core as never,
    sessionSystem: sessionSystem as never, contextSystem: { buildTextTurnContext: buildContext } as never });
  for await (const event of engine.run(context)) expect(event.type).toBe('turn_end');
  expect(persisted).toHaveBeenCalledWith('session', expect.objectContaining({ loadedSkills: ['admin'] }));
  expect(buildContext).toHaveBeenCalledWith(expect.objectContaining({ activeSkillsContext: 'Confirm duration before muting.' }));
  expect(resolved.map(tool => tool.name)).toContain('admin__mute');
  expect(provider.evaluate).toHaveBeenCalledTimes(1);
});
