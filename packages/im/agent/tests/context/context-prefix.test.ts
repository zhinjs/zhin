import { expect, it, vi } from 'vitest';
import { createUserMessage, projectPromptContext, userMessagePlainText, serializeAgentMessage, agentMessageRowToLlm, type UserMessage, renderUserMessageForLlm } from '@zhin.js/ai';
import { ContextSystem } from '../../src/context/context-system.js';
import { buildAgentsEnvelopeContext } from '../../src/context/agents-instruction.js';
import { prependTurnContextBlocks } from '../../src/context/turn-user-message.js';
import { createPromptContextBlock } from '@zhin.js/ai';
import { getGitStatusLine } from '../../src/prompt/git-context.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
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
    turnUser: { rawContent: text, promptMessages: [createUserMessage(text)] },
  });
  vi.mocked(buildAgentsEnvelopeContext).mockResolvedValue('[Agents instructions] WORKSPACE-V1');
  vi.mocked(getGitStatusLine).mockResolvedValueOnce('Git: main | clean').mockResolvedValue('Git: main | 1M');
  const first = await build('first question', 'alice');
  const stored = first.userMessages.map(message => agentMessageRowToLlm(serializeAgentMessage(message))!);
  const second = await build('second question', 'bob');
  const view = projectPromptContext([...stored, ...second.userMessages]);
  expect(view[0]).toEqual(first.userMessages[0]);
  expect(view.map(message => userMessagePlainText(message as UserMessage)).join('\n').split('WORKSPACE-V1')).toHaveLength(2);
  const latest = userMessagePlainText(view[1] as UserMessage);
  expect(latest).toContain('Git: main | 1M');
  expect(latest).toContain('Sender: id=bob');
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
    { subjectId: 'alice', roles: ['user'], scope: 'group' }, { turnId: 'turn' }), extra);
  const result = await new ContextSystem().buildTextTurnContext({
    host, turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'alice' })), content: 'current question', turnUser: { rawContent: 'current question', userMessageExtra: extra, promptMessages: [user] },
  });
  const first = result.userMessages[0]!;
  const reloaded = agentMessageRowToLlm(serializeAgentMessage(first, extra))!;
  expect(reloaded).toEqual(first);
  expect(userMessagePlainText(reloaded as UserMessage).split('quoted content')).toHaveLength(2);
  expect(userMessagePlainText(reloaded as UserMessage)).toContain('current question');
  expect(reloaded).toMatchObject({ actor: user.actor, cause: user.cause });
});

it('preserves prebuilt text blocks, provenance and current media during envelope insertion', () => {
  const user = createUserMessage('first block', [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.test/image.png' } } }]);
  user.content.push(createPromptContextBlock('custom', 'custom rule'), { type: 'text', text: 'second block\nwith linebreaks' });
  const before = structuredClone(user);
  const result = prependTurnContextBlocks([user], [{ type: 'text', text: '[Turn context] current' }])[0] as UserMessage;
  expect(result.content.slice(1)).toEqual(user.content);
  expect(result.media).toBe(user.media);
  expect(user).toEqual(before);
  const restored = agentMessageRowToLlm(serializeAgentMessage(result)) as UserMessage;
  expect(restored.media).toBeUndefined();
  expect(restored.content).toEqual(result.content);
});
