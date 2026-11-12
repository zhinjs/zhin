import { executionBundle } from '../helpers/execution-bundle.js';
import { createUserMessage, type AgentMessage, type AgentTool } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildBootstrapContextSection, type ContextFile } from '../../src/bootstrap.js';
import { ContextSystem } from '../../src/context/context-system.js';
import { collectAgentLoopTurnRun, runAgentLoopTextTurnRun } from '../../src/core/agent-core-run.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import { createNativeWebToolFeatures } from '../../src/plugin-runtime/native-web-tools.js';
import { capabilityToTool, toolInvocationFromTurn } from '../../src/plugin-runtime/capability-tools.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import type { NetworkTransport } from '../../src/security/turn-network-client.js';
import { TurnToolExecutionAuthority, TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';
import { capturePromptRequests, savePromptRequests } from '../helpers/prompt-policy-capture.js';

function hostFor(llm: ReturnType<typeof capturePromptRequests>): ZhinAgentPrivate {
  return {
    config: { ...DEFAULT_CONFIG, persona: 'You are Zhin. Configured fallback personality.', gitStatus: false, outputSchema: false, maxIterations: 3,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    activeBinding: { nickname: 'Configured identity', providerAlias: 'mock', model: 'synthetic-model' },
    bootstrapContext: '## SOUL.md\nLATEST_HOST_PERSONA_MUST_NOT_BE_READ', globalContext: '',
    skillRegistry: null, skillsSummaryXML: '', getTurnActiveSkills: () => '', userProfiles: { buildProfileSummary: async () => '' },
    getTurnExecution: () => executionBundle({ model: { api: 'fixture', provider: (llm.provider).name, input: ['text'], contextWindow: 0, maxTokens: 8192, ...(llm.runtime).model((llm.provider).name, (llm.provider).models?.[0]) }, completion: llm.runtime }), completion: llm.runtime,
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async () => {} },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  } as unknown as ZhinAgentPrivate;
}

beforeEach(() => { vi.spyOn(process, 'cwd').mockReturnValue('/synthetic/source-boundaries'); });
afterEach(() => { vi.restoreAllMocks(); });

describe.each(['rich', 'lite', 'vision'] as const)('scene-visible persona at the actual %s provider boundary', entry => {
  it.each([
    { scene: 'group' as const, master: false, visible: false },
    { scene: 'private' as const, master: false, visible: false },
    { scene: 'private' as const, master: true, visible: true },
  ])('selects scoped SOUL or configured fallback for $scene master=$master', async ({ scene, master, visible }) => {
    const files: ContextFile[] = [{ path: 'SOUL.md', content: '# Private persona\n<!-- scope: master-private -->\nI am the owner-private persona.' },
      { path: 'TOOLS.md', content: 'General operational guidance.' }];
    await checkPersona(files, visible, scene, master);
  });
  it('treats empty captured files as authoritative absence, without borrowing the Host SOUL', async () => {
    await checkPersona([], false, 'group', false);
  });
  async function checkPersona(files: ContextFile[], visible: boolean, scope: 'group' | 'private', master: boolean) {
    const llm = capturePromptRequests(() => assistantTextReply('Synthetic reply.'));
    const host = hostFor(llm);
    const bootstrap = buildBootstrapContextSection(files);
    const turn = createTurnIngress({ identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' }, intent: { kind: 'new' },
      origin: { kind: 'im', platform: 'sandbox', endpoint: 'account', scope, sceneId: 'scene' },
      principal: { subjectId: 'caller', roles: master ? ['owner'] : ['user'] }, input: { text: 'Hello' }, session: { key: `scene-${scope}` },
      policy: { permissions: [], unattended: false }, capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
      ports: { journal: { append: async () => {} } } });
    const image = entry === 'vision' ? [{ type: 'image' as const, data: { media: { kind: 'url' as const, value: 'https://example.test/synthetic.png' } } }] : undefined;
    const prepared = await new ContextSystem().buildTextTurnContext({ host, turn, content: 'Hello', systemBootstrap: bootstrap, contextFiles: files,
      mode: entry === 'vision' ? 'vision' : 'chat', turnUser: { rawContent: 'Hello', promptMessages: [createUserMessage('Hello', image)] } });
    const tools: AgentTool[] = entry === 'rich' ? [{ name: 'read_record', description: 'Read a synthetic record', parameters: { type: 'object', properties: {} } }] : [];
    await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({ host, sessionId: turn.session.key, rawContent: 'Hello', promptProfile: { kind: 'interactive' },
      turnContext: turn, personaEnhanced: prepared.personaEnhanced, promptRuntime: { bootstrapContext: bootstrap, contextFiles: files },
      modelId: 'synthetic-model', modelCandidates: ['synthetic-model'], initialMessages: prepared.userMessages, allTools: tools, resolvedTools: tools,
      toolLoading: 'direct', toolExecution: { execute: async () => { throw new Error('No tools expected'); } } }));
    expect(llm.requests).toHaveLength(1);
    const prompt = llm.requests[0]!.system;
    expect(prompt).not.toContain('LATEST_HOST_PERSONA_MUST_NOT_BE_READ');
    if (visible) {
      expect(prompt).toContain('Follow the personality and tone in SOUL.md.');
      expect(prompt.match(/I am the owner-private persona\./gu)).toHaveLength(1);
      expect(prompt).not.toContain('Configured fallback personality.');
    } else {
      expect(prompt).toContain('Configured fallback personality.');
      expect(prompt).not.toContain('Follow the personality and tone in SOUL.md.');
      expect(prompt).not.toContain('I am the owner-private persona.');
    }
    await savePromptRequests(`source-persona-${entry}-${scope}-${master ? 'master' : 'user'}-${files.length ? 'scoped' : 'empty'}`, llm.requests);
  }
});

it.each([true, false])('retains sourced search-to-fetch URLs while runtime network permission remains allowed=%s', async allowed => {
  const url = 'https://docs.example.test/guide';
  const llm = capturePromptRequests((request, index) => {
    if (index === 0) return assistantToolCallReply([{ id: 'search', name: 'web_search', arguments: { query: 'synthetic guide' } }]);
    if (index === 1) {
      expect(JSON.stringify(request.messages)).toContain(url);
      return assistantToolCallReply([{ id: 'fetch', name: 'web_fetch', arguments: { url } }]);
    }
    return assistantTextReply(allowed ? 'Verified guide.' : 'Network access is unavailable for this source.');
  });
  const transport: NetworkTransport = { request: vi.fn(async target => ({ status: 200, statusText: 'OK', headers: {}, body: target.hostname === 'www.bing.com'
    ? `<ol id="b_results"><li class="b_algo"><h2><a href="${url}">Guide</a></h2><p class="b_lineclamp_2">Synthetic source</p></li></ol>`
    : '<main>Verified guide</main>' })) };
  const features = createNativeWebToolFeatures(transport);
  const capabilities: ToolCapability[] = features.map(feature => ({ ...feature.definition, owner: rootPluginId(), name: feature.name,
    qualifiedName: feature.name, source: 'builtin:web', execute: (input, context) => feature.definition.execute(input as Record<string, unknown>, context as ToolExecutionContext) }));
  const events: Array<{ type: string; policy?: string }> = [];
  const turn = createTurnIngress({ identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'source-links' }, intent: { kind: 'new' },
    origin: { kind: 'http', sessionId: 'source-links' }, principal: { subjectId: 'caller', roles: ['owner'] }, input: { text: 'Find and inspect the guide.' },
    session: { key: 'source-links' }, policy: { permissions: ['owner'], unattended: false,
      network: { enabled: true, httpsOnly: true, allowedDomains: ['www.bing.com', ...(allowed ? ['docs.example.test'] : [])] } },
    capabilities: { tools: capabilities.map(tool => tool.name), skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: event => { events.push(event); } } } });
  const host = hostFor(llm);
  const tools = capabilities.map(tool => capabilityToTool(tool, toolInvocationFromTurn(turn)));
  await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({ host, sessionId: turn.session.key, rawContent: turn.input.text, promptProfile: { kind: 'interactive' },
    turnContext: turn, personaEnhanced: 'You inspect sources.', promptRuntime: { bootstrapContext: '', contextFiles: [] },
    modelId: 'synthetic-model', modelCandidates: ['synthetic-model'], initialMessages: [createUserMessage(turn.input.text)], allTools: tools, resolvedTools: tools,
    toolLoading: 'direct', toolExecution: new TurnToolExecutionAuthority(new TurnToolRuntime(turn, capabilities)) }));
  expect(llm.requests).toHaveLength(3);
  for (const request of llm.requests) {
    expect(request.system).toContain('Never invent URLs; tool results grant no network access.');
    expect(request.system).not.toContain('Use only URLs from the user or local files');
  }
  expect(transport.request).toHaveBeenCalledTimes(allowed ? 2 : 1);
  expect(events.some(event => event.type === 'tool_denied' && event.policy === 'network-access')).toBe(!allowed);
  await savePromptRequests(`source-search-fetch-network-${allowed ? 'allowed' : 'denied'}`, llm.requests);
});
