import { createUserMessage, type AgentMessage } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildBootstrapContextSection } from '../../src/bootstrap.js';
import { ContextSystem } from '../../src/context/context-system.js';
import { collectAgentLoopTurnRun, runAgentLoopTextTurnRun } from '../../src/core/agent-core-run.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import { buildDisciplinedPrompt, buildMultimodalVisionSystemPrompt } from '../../src/prompt/assembly.js';
import { REQUEST_SECURITY_BOUNDARY } from '../../src/prompt/system-prompt.js';
import { CRITICAL_RULES } from '../../src/prompt/rules/critical-rules.js';
import type { TurnContextView } from '../../src/context/turn-envelope.js';
import { assistantTextReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';

const SOUL = '我是一个喜欢音乐、认真聊天的人。';
const BOOTSTRAP = buildBootstrapContextSection([
  { path: 'SOUL.md', content: SOUL },
  { path: 'TOOLS.md', content: 'Use the established workflow.\n\n### Owner notes\n<!-- scope: master-private -->\nOwner-only operational notes.' },
]);

it.each(['http', 'internal'] as const)('preserves the configured binding nickname on a tool-less non-IM %s turn without SOUL', async entry => {
  const llm = wireMockLlmApi({ models: ['m'], responder: () => assistantTextReply('Synthetic reply.') });
  const host = {
    config: { ...DEFAULT_CONFIG, gitStatus: false, outputSchema: false, maxIterations: 1,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    activeBinding: { nickname: 'Configured non-IM identity' }, bootstrapContext: '', globalContext: '',
    userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => llm.provider, modelRegistry: null, llmRuntime: llm.runtime,
    getTurnActiveSkills: () => '',
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async () => {} },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  } as unknown as ZhinAgentPrivate;
  const turn: TurnContextView = {
    origin: entry === 'http' ? { kind: 'http', sessionId: entry } : { kind: 'internal', source: entry },
    principal: { subjectId: 'caller', roles: ['user'] }, session: { key: entry },
  };
  const current = createUserMessage('Who are you?');
  const prepared = await new ContextSystem().buildTextTurnContext({ host, turn,
    content: 'Who are you?', turnUser: { rawContent: 'Who are you?', promptMessages: [current] } });
  await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host, sessionId: entry, rawContent: 'Who are you?', promptProfile: { kind: 'interactive' }, turnContext: turn,
    allTools: [], resolvedTools: [], toolLoading: 'direct', toolExecution: { execute: async () => { throw new Error('No tools'); } },
    personaEnhanced: prepared.personaEnhanced, modelId: 'm', modelCandidates: ['m'], initialMessages: prepared.userMessages,
  }));
  expect(llm.calls[0]?.context.systemPrompt).toContain('You are Configured non-IM identity');
  expect(llm.calls[0]?.context.systemPrompt).not.toContain('You are Zhin');
});

it.each(['chat', 'vision', 'http'] as const)('sends a neutral persona with scoped first-person SOUL on the actual tool-less %s path', async entry => {
  const mode = entry === 'vision' ? 'vision' : 'chat';
  const llm = wireMockLlmApi({ models: ['m'], responder: () => assistantTextReply('好。') });
  const host = {
    config: { ...DEFAULT_CONFIG, gitStatus: false, outputSchema: false, maxIterations: 1,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    activeBinding: { nickname: 'Configured fallback' }, bootstrapContext: BOOTSTRAP, globalContext: '',
    userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => llm.provider, modelRegistry: null, llmRuntime: llm.runtime,
    getTurnActiveSkills: () => '',
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async () => {} },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
    buildDisciplinedPrompt: (persona: string) => buildDisciplinedPrompt(host, persona),
  } as unknown as ZhinAgentPrivate;
  const preparedPersonas: string[] = [];
  for (const nickname of ['Actual account A', 'Actual account B']) {
    const turn: TurnContextView = {
      origin: entry === 'http' ? { kind: 'http', sessionId: nickname }
        : { kind: 'im', platform: 'icqq', endpoint: nickname, scope: 'group', sceneId: 'group' },
      principal: { subjectId: 'member', roles: ['user'] }, session: { key: nickname },
      input: { contextState: { bot: { name: nickname, profile: { values: { nickname }, sources: { nickname: 'platform' },
        writableFields: [], platformStatus: 'available' } } } },
    };
    const current = createUserMessage('我想听音乐。', mode === 'vision'
      ? [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.test/synthetic.png' } } }]
      : undefined);
    const prepared = await new ContextSystem().buildTextTurnContext({ host, turn, mode,
      content: '我想听音乐。', turnUser: { rawContent: '我想听音乐。', promptMessages: [current] } });
    preparedPersonas.push(prepared.personaEnhanced);
    await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
      host, sessionId: nickname, rawContent: '我想听音乐。', promptProfile: { kind: 'interactive' }, turnContext: turn,
      allTools: [], resolvedTools: [], toolLoading: 'direct', toolExecution: { execute: async () => { throw new Error('No tools are offered'); } },
      personaEnhanced: prepared.personaEnhanced, modelId: 'm', modelCandidates: ['m'], initialMessages: prepared.userMessages,
    }));
    const sent = llm.calls.at(-1)!.context;
    expect(sent.systemPrompt).toContain('Follow the personality and tone in SOUL.md.');
    expect(sent.systemPrompt?.split(SOUL)).toHaveLength(2);
    expect(sent.systemPrompt?.match(/Follow the personality and tone in SOUL\.md\.|Use SOUL\.md for persona and tone\./gu)).toHaveLength(1);
    expect(sent.systemPrompt?.match(/^# Style$/gmu)).toHaveLength(1);
    expect(sent.systemPrompt?.match(/^# Safety$/gmu)).toHaveLength(1);
    expect(sent.systemPrompt?.split(CRITICAL_RULES)).toHaveLength(2);
    expect(sent.systemPrompt?.split(REQUEST_SECURITY_BOUNDARY)).toHaveLength(2);
    expect(sent.systemPrompt).not.toMatch(/You are Zhin|Configured fallback|Actual account|Owner-only/);
    const messages = JSON.stringify(sent.messages);
    expect(messages.match(/Your account/gu) ?? []).toHaveLength(entry === 'http' ? 0 : 1);
    expect(messages).toContain(nickname);
    expect(messages).toContain('我想听音乐。'); // User prose remains first-person data.
    if (mode === 'vision') expect(messages).toContain('https://example.test/synthetic.png');
  }
  expect(preparedPersonas[0]).toBe(preparedPersonas[1]);
  expect(llm.calls[0]!.context.systemPrompt).toBe(llm.calls[1]!.context.systemPrompt);

  // The public lite/vision assembly consumes the same prepared persona, rather than reassigning a name.
  const lite = await buildMultimodalVisionSystemPrompt(host, { turn: { origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'test', roles: [] }, session: { key: 'test' } }, sessionId: 'test', textContent: '',
    personaEnhanced: preparedPersonas[0]! });
  expect(lite).toContain(SOUL);
  expect(lite.match(/^# Safety$/gmu)).toHaveLength(1);
  expect(lite.split(CRITICAL_RULES)).toHaveLength(2);
  expect(lite.split(REQUEST_SECURITY_BOUNDARY)).toHaveLength(2);
  expect(lite).not.toContain('You are Zhin');
});
