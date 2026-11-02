import { rootPluginId } from '@zhin.js/plugin-runtime';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { defaultAgentCore } from '../../src/core/agent-core.js';
import type { ZhinAgentPrivate } from '../../src/internal/agent-host.js';
import { createSubagentTurnCapability } from '../../src/plugin-runtime/subagent-turn-capability.js';
import { toolInvocationFromTurn } from '../../src/plugin-runtime/capability-tools.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { buildBootstrapContextSection } from '../../src/bootstrap.js';
import { assistantTextReply, wireMockLlmApi } from '../helpers/mock-llm-api.js';

it('keeps the delegated role at the actual provider boundary without losing workspace, platform or safety rules', async () => {
  const llm = wireMockLlmApi({ models: ['m'], responder: () => assistantTextReply('Read-only inspection complete.') });
  const soul = '我是主群里爱发短句的朋友。';
  const capturedBootstrap = buildBootstrapContextSection([
    { path: 'SOUL.md', content: `${soul}\n\n# Nested personality\nSpeak with this main persona.` },
    { path: 'TOOLS.md', content: 'Verify file context before editing.\n\n### Private notes\n<!-- scope: master-private -->\nOwner-private configuration.' },
  ]);
  const host = {
    config: { ...DEFAULT_CONFIG, gitStatus: false, maxSubagentIterations: 1,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    activeBinding: { nickname: 'Main chat persona', providerAlias: 'mock', model: 'm' },
    bootstrapContext: '', // CLI supplies workspace text through the captured engine, not mutable Host state.
    globalContext: '# Platform rules\nUse the current ICQQ endpoint; never guess a recipient.',
    getTurnProvider: () => llm.provider, llmRuntime: llm.runtime,
    skillRegistry: null, skillsSummaryXML: '', getTurnActiveSkills: () => '',
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async () => {} },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  } as unknown as ZhinAgentPrivate;
  const task = 'Inspect the synthetic record; preserve the quote "I prefer tea" as data and report to the parent.';
  const parentTurn = createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'parent' }, intent: { kind: 'new' },
    origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group' },
    principal: { subjectId: 'member', roles: ['user'] }, input: { text: 'Inspect.', locale: 'en' },
    session: { key: 'im:group:member' }, policy: { permissions: ['user'], unattended: false },
    capabilities: { tools: ['read_file'], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: async () => {} } },
  });
  const read: ToolCapability = { owner: rootPluginId(), name: 'read_file', qualifiedName: 'read_file', description: 'Read a synthetic record.',
    source: 'builtin:read_file', readOnly: true, requiresApproval: 'never' as const,
    inputSchema: { type: 'object', properties: {} }, execute: async () => { throw new Error('No model tool call is expected'); } };
  const child = createSubagentTurnCapability({ host, core: defaultAgentCore, parentTurn, bootstrapContext: capturedBootstrap,
    capabilities: { generation: 1, owner: rootPluginId(), tools: [read], skills: [], agents: [], mcp: [], promptSections: [] },
    resolveModel: () => ({ modelId: 'm', modelCandidates: ['m'] }),
  });
  await child.execute({ task, read_only: true }, toolInvocationFromTurn(parentTurn));
  expect(llm.calls).toHaveLength(1);
  const sent = llm.calls[0]!.context;
  expect(sent.systemPrompt).toContain('You are a sub-agent executing one delegated task for the main assistant.');
  expect(sent.systemPrompt).toContain('you cannot delegate further');
  expect(sent.systemPrompt).toContain('Do not greet or address the end user');
  expect(sent.systemPrompt).not.toContain(soul);
  expect(sent.systemPrompt).not.toContain('Speak with this main persona.');
  expect(sent.systemPrompt).not.toContain('Use SOUL.md for persona and tone.');
  expect(sent.systemPrompt).not.toContain('# Chat style');
  expect(sent.systemPrompt).not.toContain('Use spawn_task');
  expect(sent.systemPrompt).toContain('Verify file context before editing.');
  expect(sent.systemPrompt).not.toContain('Owner-private configuration.');
  expect(sent.systemPrompt).toContain('Use the current ICQQ endpoint; never guess a recipient.');
  expect(sent.systemPrompt).toContain('# Security');
  expect(sent.systemPrompt).toContain('server-verified sender');
  expect(sent.systemPrompt).toContain('without confirmed execution or observation evidence');
  const names = sent.tools?.map(tool => tool.name);
  expect(names).toContain('read_file');
  expect(names).not.toContain('spawn_task');
  expect(JSON.stringify(sent.messages)).toContain('I prefer tea');
});
