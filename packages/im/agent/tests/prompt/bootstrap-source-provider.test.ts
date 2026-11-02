import { createUserMessage, type AgentMessage } from '@zhin.js/ai';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { buildBootstrapContextSection } from '../../src/bootstrap.js';
import { collectAgentLoopTurnRun, runAgentLoopTextTurnRun } from '../../src/core/agent-core-run.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { assistantTextReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';
import { ContextSystem } from '../../src/context/context-system.js';

function createHost(llm: ReturnType<typeof wireMockLlmApi>): ZhinAgentPrivate {
  return {
    config: { ...DEFAULT_CONFIG, gitStatus: false, outputSchema: false, maxIterations: 1,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    activeBinding: { providerAlias: 'mock', model: 'm' }, bootstrapContext: 'Latest unrelated Host workspace.',
    globalContext: '', getTurnActiveSkills: () => '', getTurnProvider: () => llm.provider,
    userProfiles: { buildProfileSummary: async () => '' }, modelRegistry: null, llmRuntime: llm.runtime,
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async () => {} },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  } as unknown as ZhinAgentPrivate;
}

it.each(['captured', 'empty'] as const)('scopes %s schedule file sources at the actual provider boundary', async mode => {
  const contextFiles = [
    { path: 'SOUL.md', content: 'First-person persona.' },
    { path: 'AGENTS.md', content: 'Keep public task instructions.\n# Owner procedures\n<!-- scope: master-private -->\nPrivate first instruction.\n## TOOLS.md\nPrivate nested instruction.' },
    { path: 'TOOLS.md', content: 'Use verified results.' },
  ];
  const bootstrap = buildBootstrapContextSection(contextFiles);
  const llm = wireMockLlmApi({ models: ['m'], responder: () => assistantTextReply('Synthetic scheduled result.') });
  const host = createHost(llm);
  const security = { execPreset: 'readonly' as const, allowedDomains: [] };
  const turn = createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'schedule' }, intent: { kind: 'new' },
    origin: { kind: 'schedule', jobId: 'job' }, principal: { subjectId: 'creator', roles: ['trusted'] },
    input: { text: 'Generate a synthetic report.' }, session: { key: 'schedule:job' },
    execution: { kind: 'schedule', security }, policy: { permissions: [], unattended: true,
      network: { enabled: true, httpsOnly: true, allowedDomains: [] }, shell: { preset: 'readonly' },
      filesystem: { workspaceRoot: process.cwd() } },
    capabilities: { tools: [], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => {} } },
  });
  await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host, sessionId: 'schedule:job', rawContent: turn.input.text,
    promptProfile: { kind: 'schedule', jobId: 'job', prompt: turn.input.text,
      security: { ...security, rejectOwnerApproval: true } }, turnContext: turn,
    promptRuntime: { bootstrapContext: bootstrap, ...{ contextFiles: mode === 'empty' ? [] : contextFiles } },
    allTools: [], resolvedTools: [], toolLoading: 'direct',
    toolExecution: { execute: async () => { throw new Error('No tools'); } },
    personaEnhanced: 'Unused schedule persona.', modelId: 'm', modelCandidates: ['m'],
    initialMessages: [createUserMessage(turn.input.text)],
  }));
  const sent = llm.calls[0]!.context.systemPrompt;
  expect(sent).not.toContain('Private first instruction.');
  expect(sent).not.toContain('Private nested instruction.');
  expect(sent).not.toContain('Latest unrelated Host workspace.');
  if (mode === 'captured') expect(sent).toContain('Keep public task instructions.');
  else expect(sent).not.toContain('Keep public task instructions.');
});

it('scopes captured files on a real tool-less IM request without treating document headings as Host boundaries', async () => {
  const llm = wireMockLlmApi({ models: ['m'], responder: () => assistantTextReply('Synthetic chat result.') });
  const host = createHost(llm);
  const contextFiles = [{ path: 'AGENTS.md', content: '# Public\n## SOUL.md\nKeep public guidance.\n# Owner\n<!-- scope: master-private -->\nsecret\n## TOOLS.md\nNested secret.' }];
  const turn = createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'chat' }, intent: { kind: 'new' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group' },
    principal: { subjectId: 'member', roles: ['user'] }, input: { text: 'Hello.' }, session: { key: 'chat' },
    policy: { permissions: ['user'], unattended: false }, capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal, ports: { journal: { append: async () => {} } },
  });
  const prepared = await new ContextSystem().buildTextTurnContext({ host, turn, contextFiles,
    content: turn.input.text, turnUser: { rawContent: turn.input.text, promptMessages: [createUserMessage(turn.input.text)] } });
  await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host, sessionId: 'chat', rawContent: turn.input.text, promptProfile: { kind: 'interactive' }, turnContext: turn,
    allTools: [], resolvedTools: [], toolLoading: 'direct',
    toolExecution: { execute: async () => { throw new Error('No tools'); } },
    personaEnhanced: prepared.personaEnhanced, modelId: 'm', modelCandidates: ['m'], initialMessages: prepared.userMessages,
  }));
  const sent = llm.calls[0]!.context.systemPrompt;
  expect(sent).toContain('## SOUL.md\nKeep public guidance.');
  expect(sent).not.toContain('Nested secret.');
  expect(sent).not.toContain('Latest unrelated Host workspace.');
});
