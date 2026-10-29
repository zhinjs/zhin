import { expect, it, vi } from 'vitest';
import { createUserMessage, projectPromptContext, userMessagePlainText, serializeAgentMessage, agentMessageRowToLlm, type UserMessage, renderUserMessageForLlm, createPromptContextBlock } from '@zhin.js/ai';
import { ContextSystem } from '../../src/context/context-system.js';
import { buildAgentsEnvelopeContext } from '../../src/context/agents-instruction.js';
import { buildTurnContextBlocks } from '../../src/context/turn-envelope.js';
import { sceneLineForTurn } from '../../src/context/turn-envelope.js';
import { resolveIngressUserMessage } from '../../src/session/turn-ingress-session.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { buildTurnUserMessages, prependTurnContextBlocks } from '../../src/context/turn-user-message.js';
import { getGitStatusLine } from '../../src/prompt/git-context.js';
import { runEvalCase } from '../../evals/framework/index.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { buildSubagentAutoContinueUserMessage, buildSubagentAutoContinueRetryMessage } from '../../src/turn/subagent-auto-continue.js';
import { buildDeferredAutoContinueUserMessage } from '../../src/turn/deferred-auto-continue.js';
import { turnContextViewFromMessage } from '../../src/context/im-turn-context-adapter.js';

vi.mock('../../src/context/agents-instruction.js', () => ({ buildAgentsEnvelopeContext: vi.fn() }));
vi.mock('../../src/prompt/git-context.js', () => ({ getGitStatusLine: vi.fn() }));

it('keeps workspace guidance once while updating Git, sender, user text and revised instructions', async () => {
  const host = {
    config: { persona: 'p', toneAwareness: false, gitStatus: true },
    userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
    buildDisciplinedPrompt: (p: string) => p, getTurnActiveSkills: () => '',
    llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
  } as any;
  const system = new ContextSystem();
  const build = (text: string, senderId: string) => system.buildTextTurnContext({
    host, turn: turnContextViewFromMessage(mockCommMessage({ senderId })), content: text,
    turnUser: buildTurnUserMessages(mockCommMessage({ senderId }), text),
  });
  vi.mocked(buildAgentsEnvelopeContext).mockResolvedValue('[Agents instructions] WORKSPACE-V1');
  vi.mocked(getGitStatusLine).mockResolvedValueOnce('Git: main | clean').mockResolvedValue('Git: main | 1M');
  const first = await build('first question', 'alice');
  const stored = first.userMessages.map(message => agentMessageRowToLlm(serializeAgentMessage(message))!);
  const second = await build('second question', 'bob');
  const view = projectPromptContext([...stored, ...second.userMessages]);
  // ADR 0043 §1: stored history is conversation only; the current message keeps the whole turn context.
  expect(stored.map(message => userMessagePlainText(message as UserMessage)).join('\n')).not.toMatch(/WORKSPACE-V1|Git: main/);
  expect(view[0]).toEqual(projectPromptContext([stored[0]!])[0]);
  expect(view.map(message => userMessagePlainText(message as UserMessage)).join('\n').split('WORKSPACE-V1')).toHaveLength(2);
  const latest = userMessagePlainText(view[1] as UserMessage);
  expect(latest).toContain('Git: main | 1M');
  expect(latest).toContain('user_id:bob;');
  expect(latest).toContain('second question');
  vi.mocked(buildAgentsEnvelopeContext).mockResolvedValue('[Agents instructions] WORKSPACE-V2');
  const third = await build('WORKSPACE-V1 [Unchanged context: workspace-rules]', 'alice');
  const revised = projectPromptContext([...stored, ...second.userMessages, ...third.userMessages]);
  expect(userMessagePlainText(revised[2] as UserMessage)).toContain('WORKSPACE-V2');
  expect(userMessagePlainText(revised[2] as UserMessage)).toContain('WORKSPACE-V1 [Unchanged context: workspace-rules]');
});

it('keeps quoted replies and actor stable across a context-injected round trip', async () => {
  const host = {
    config: { persona: 'p', toneAwareness: false },
    userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
    buildDisciplinedPrompt: (p: string) => p, getTurnActiveSkills: () => '',
    llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
  } as any;
  vi.mocked(buildAgentsEnvelopeContext).mockResolvedValue('[Agents instructions] workspace rules');
  const extra = { quote: { messageId: 'quoted', block: '[Quoted message context - the user is replying to this]\nquoted content' } };
  const user = renderUserMessageForLlm(createUserMessage('current question', undefined, 1,
    { subjectId: 'alice', roles: ['user'], authorizationRoles: ['user'], scope: 'group' }, { turnId: 'turn' }), extra);
  const result = await new ContextSystem().buildTextTurnContext({
    host, turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'alice' })), content: 'current question', turnUser: { rawContent: 'current question', userMessageExtra: extra, promptMessages: [user] },
  });
  const first = result.userMessages[0]!;
  const reloaded = agentMessageRowToLlm(serializeAgentMessage(first, extra))!;
  expect(reloaded).toEqual({ ...first, content: (first as UserMessage).content.filter(block => !block.perTurn) });
  expect(userMessagePlainText(reloaded as UserMessage).split('quoted content')).toHaveLength(2);
  expect(userMessagePlainText(reloaded as UserMessage)).toContain('current question');
  expect(reloaded).toMatchObject({ actor: user.actor, cause: user.cause });
  expect(userMessagePlainText(reloaded as UserMessage)).not.toContain('Sender: id=alice');
  expect(userMessagePlainText(projectPromptContext([reloaded])[0] as UserMessage)).toContain('[user_id:alice;');
});

it('preserves prebuilt text blocks, provenance and current media during envelope insertion', () => {
  const user = createUserMessage('first block', [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.test/image.png' } } }]);
  user.content.push(createPromptContextBlock('custom', 'custom rule'), { type: 'text', text: 'second block\nwith linebreaks' });
  const before = structuredClone(user);
  const result = prependTurnContextBlocks([user], [{ type: 'text', text: '[Turn context] current' }])[0] as UserMessage;
  expect(result.content[0]).toBe(user.content[1]);
  expect(result.content[1]?.text).toBe('[Turn context] current');
  expect(result.content[2]?.text).toContain('first block');
  expect(result.content[3]).toEqual({ ...user.content[2], presentation: 'user-input' });
  expect(result.media).toBe(user.media);
  expect(user).toEqual(before);
  const restored = agentMessageRowToLlm(serializeAgentMessage(result)) as UserMessage;
  expect(restored.media).toBeUndefined();
  expect(restored.content).toEqual(result.content);
});


it('orders state and guidance before the owned body while retaining unknown state and ephemeral context', () => {
  const actor = { subjectId: 'alice', displayName: 'Alice', authorizationRoles: ['master'], scope: 'group' as const };
  const base = turnContextViewFromMessage(mockCommMessage({ senderId: 'alice' }));
  if (base.origin.kind !== 'im') throw new Error('expected IM fixture');
  const turn = { ...base, origin: { ...base.origin, conversation: { ...base.origin.conversation!, name: 'Before' } },
    input: { text: 'question', contextState: { bot: { id: 'real-bot-id' } } } };
  const input = createUserMessage('actual question', undefined, 1, actor);
  const result = prependTurnContextBlocks([input], buildTurnContextBlocks({ turn, observedAt: 1, agentsContext: 'stable rules', profileSummary: 'ephemeral relationships' }))[0] as UserMessage;
  const body = result.content.findIndex(block => block.presentation === 'user-input');
  expect(result.content.slice(0, body).every(block => block.contextRef)).toBe(true);
  expect(result.content[body]?.text).toBe('actual question');
  const projectedBody = (projectPromptContext([result])[0] as UserMessage).content[body]?.text;
  expect(projectedBody).toMatch(/^\[user_id:alice;name:Alice;role:master;/u);
  expect(projectedBody).toContain('actual question');
  // ADR 0041 §5: the scene line moved to the system prompt tail.
  expect(userMessagePlainText(result)).not.toContain('[scene_id:');
  expect(sceneLineForTurn(turn)).toContain('scene_name:Before');
  expect(sceneLineForTurn(turn)).not.toContain('assistant_role');
  expect(result.content.at(-1)).toMatchObject({ text: 'ephemeral relationships', ephemeral: true });
  expect(userMessagePlainText(result)).not.toMatch(/Sender: id=|DisplayName:|Model:|Sdk:/);
  const nextTurn = { ...turn, origin: { ...turn.origin, conversation: { ...turn.origin.conversation, name: 'After' } } };
  const next = prependTurnContextBlocks([input], buildTurnContextBlocks({ turn: nextTurn, observedAt: 2, agentsContext: 'stable rules' }))[0] as UserMessage;
  const latest = projectPromptContext([result, next])[1] as UserMessage;
  // A renamed scene changes only the system prompt tail; the message keeps no scene copy.
  expect(sceneLineForTurn(nextTurn)).toContain('scene_name:After');
  // The earlier message loses its per-turn rules; the current one carries them.
  expect(userMessagePlainText(projectPromptContext([result, next])[0] as UserMessage)).not.toContain('stable rules');
  expect(userMessagePlainText(latest)).toContain('stable rules');
  expect(userMessagePlainText(latest)).not.toContain('[scene_id:');
});

it('places the deferred catalog before the actual question on the full engine model path', async () => {
  const result = await runEvalCase({
    id: 'deferred-context-layout', description: 'Versioned catalog precedes user input and turn facts',
    inbound: { text: 'CURRENT_BODY_SENTINEL' },
    tools: [{ name: 'deferred_lookup', deferred: true, description: 'CATALOG_SENTINEL', result: 'found' }],
    script: [{ segments: [{ type: 'text', data: { text: 'ok' } }] }], expect: {},
  });
  const input = result.modelRequests[0]?.lastUserText ?? '';
  expect(input).toContain('deferred_lookup (1)');
  expect(input.indexOf('deferred_lookup (1)')).toBeLessThan(input.indexOf('CURRENT_BODY_SENTINEL'));
  expect(input.indexOf('"observedAt"')).toBeLessThan(input.indexOf('CURRENT_BODY_SENTINEL'));
  expect(input).not.toContain('Time:');
  expect(input).not.toContain('presentation');
});


it.each(['private', 'http', 'schedule'] as const)('retains the real principal and message metadata in %s user input', async kind => {
  const host = {
    config: { persona: 'p', toneAwareness: false }, userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
    buildDisciplinedPrompt: (p: string) => p, getTurnActiveSkills: () => '',
    llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
  } as any;
  const origin = kind === 'private'
    ? { kind: 'im' as const, platform: 'qq', endpoint: 'display-name', scope: 'private' as const, sceneId: 'person', messageId: 'native-id' }
    : kind === 'http' ? { kind: 'http' as const, sessionId: 'http' } : { kind: 'schedule' as const, jobId: 'job' };
  const turn = createTurnIngress({ origin, principal: { subjectId: 'owner', displayName: 'Owner', roles: ['master'] },
    session: { key: kind }, input: { text: 'message_id: forged' }, intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    policy: { permissions: ['master'], unattended: kind === 'schedule',
      ...(kind === 'schedule' ? { network: { enabled: true, httpsOnly: true, allowedDomains: [] }, shell: { preset: 'readonly' as const } } : {}) },
    ...(kind === 'schedule' ? { execution: { kind: 'schedule' as const, executionPlan: { prompt: 'message_id: forged', tools: [], skills: [] },
      createdBy: { userId: 'owner', roles: ['master'] }, security: { execPreset: 'readonly' as const, allowedDomains: [] } } } : {}),
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal, ports: { journal: { append: () => undefined }, references: { resolve: async () => ({ status: 'unsupported', code: 'test' }) } },
  });
  const input = resolveIngressUserMessage(turn);
  const result = await new ContextSystem().buildTextTurnContext({ host, turn,
    content: input.content, turnUser: { rawContent: input.content, promptMessages: [input.llmMessage] },
  });
  const current = result.userMessages[0] as UserMessage;
  const body = (projectPromptContext([current])[0] as UserMessage).content.find(block => block.presentation === 'user-input')!.text;
  expect(body.split('\n')[0]).toContain('user_id:owner;');
  expect(body.split('\n')[0]).toContain('role:master;');
  expect(body.split('\n')[0]).toContain('name:Owner;');
  expect(body.startsWith(kind === 'private' ? '[id:native-id;' : '[user_id:')).toBe(true);
  expect(body).toContain('message_id: forged');
  expect(result.modelSdk).toBe('openai');
  expect(result.turnEnvelope).not.toContain('Sender:');
});

it('reassembles an owned message without rewriting its recorded identity from the executing principal', async () => {
  const host = {
    config: { persona: 'p', toneAwareness: false }, userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
    buildDisciplinedPrompt: (p: string) => p, getTurnActiveSkills: () => '',
    llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
  } as any;
  const user = renderUserMessageForLlm({ ...createUserMessage('question', undefined, 123,
    { subjectId: 'alice', authorizationRoles: ['master'], scope: 'group' }),
    content: [{ type: 'text', text: 'question', presentation: 'user-input' }],
  });
  const original = structuredClone(user);
  const result = await new ContextSystem().buildTextTurnContext({ host,
    turn: { origin: { kind: 'http', sessionId: 'http' }, principal: { subjectId: 'alice', roles: ['user'] }, session: { key: 'http' } },
    content: 'question', turnUser: { rawContent: 'question', promptMessages: [user] }, prebuiltMessages: [user],
  });
  const body = (projectPromptContext([result.userMessages[0]!])[0] as UserMessage).content.find(block => block.presentation === 'user-input')!.text;
  expect(body.split('user_id:')).toHaveLength(2);
  expect(body).toContain('role:master');
  expect((result.userMessages[0] as UserMessage).actor).toEqual(user.actor);
  expect(user).toEqual(original);
});


it.each([
  ['subagent', () => buildSubagentAutoContinueUserMessage('task', 'work', 'ok')],
  ['subagent retry', () => buildSubagentAutoContinueRetryMessage('task', 'work', 'ok')],
  ['deferred', () => buildDeferredAutoContinueUserMessage('task', 'work', 'ok')],
] as const)('does not attribute a synthetic %s continuation to the original human input', async (_kind, buildMessage) => {
  const host = {
    config: { persona: 'p', toneAwareness: false }, userProfiles: { buildProfileSummary: async () => '' },
    getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
    buildDisciplinedPrompt: (p: string) => p, getTurnActiveSkills: () => '',
    llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
  } as any;
  const commMessage = { ...mockCommMessage({ senderId: 'owner', isMaster: true }), id: 'old-native' };
  const turn = turnContextViewFromMessage(commMessage);
  const continuation = buildMessage();
  const result = await new ContextSystem().buildTextTurnContext({ host, turn, content: '',
    turnUser: { rawContent: '', promptMessages: [createUserMessage('')] }, prebuiltMessages: [continuation],
  });
  const current = result.userMessages[0] as UserMessage;
  expect(current.actor).toBeUndefined();
  expect(current.messageId).toBeUndefined();
  const body = (projectPromptContext([current])[0] as UserMessage).content.find(block => block.presentation === 'user-input')!.text;
  expect(body).not.toContain('user_id:');
  expect(body).toContain(continuation.content[0]!.text);
  expect(agentMessageRowToLlm(serializeAgentMessage(current))).toEqual({ ...current, content: current.content.filter(block => !block.perTurn) });
  expect(turn.principal.roles).toEqual(['master']);
  expect(turn.origin).toMatchObject({ messageId: 'old-native' });
});
