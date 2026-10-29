import { describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import {
  ContextSystem,
  ToneInjector,
  ProfileContextBuilder,
  createContextSystemForHost,
} from '../../src/context/context-system.js';
import type { ContextBuilder } from '../../src/context/contracts.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { turnContextViewFromMessage } from '../../src/context/im-turn-context-adapter.js';

describe('ContextSystem', () => {
  it('projects canonical endpoint identity when shortcut fields are absent', () => {
    const message = {
      ...mockCommMessage({ adapter: 'qq', endpoint: 'bot1', senderId: 'u1' }),
      clientAdapter: undefined,
      endpointId: undefined,
    };
    expect(turnContextViewFromMessage(message).origin).toMatchObject({
      platform: 'qq',
      endpoint: 'bot1',
    });
  });

  it('buildTextTurnContext merges registered builder messages and injectors', async () => {
    const host = {
      config: { persona: 'p', toneAwareness: false },
      userProfiles: { buildProfileSummary: async () => '' },
      getTurnProvider: () => ({ name: 'openai', models: ['gpt-4o-mini'] }),
      modelRegistry: null,
      buildDisciplinedPrompt: (p: string) => p,
      getTurnActiveSkills: () => '',
      llmRuntime: { model: () => ({ id: 'gpt-4o-mini', sdk: 'openai', input: ['text'] }) },
    } as any;

    const system = createContextSystemForHost(host);
    const extra = createUserMessage('extra-context');
    const builder: ContextBuilder = {
      name: 'test-extra',
      build: async () => [extra],
    };
    system.addBuilder(builder);

    const commMessage = mockCommMessage({ senderId: 'u1' });
    const result = await system.buildTextTurnContext({
      host,
      turn: turnContextViewFromMessage(commMessage),
      content: 'hello',
      turnUser: {
        rawContent: 'hello',
        promptMessages: [createUserMessage('hello')],
      },
    });

    expect(result.userMessages.length).toBeGreaterThan(1);
    expect(result.userMessages[0]).toEqual(extra);
  });

  it('build() pipeline writes profile and tone into envelope via builders/injectors', async () => {
    const host = {
      config: { toneAwareness: true },
      userProfiles: { buildProfileSummary: async () => 'User prefers concise replies.' },
    } as any;
    const system = new ContextSystem();
    const envelope: Record<string, string | undefined> = {};
    const messages = await system.build({
      turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'u1' })),
      inboundContent: 'I am very frustrated!!!',
      host,
      envelope,
    });

    expect(messages).toEqual([]);
    expect(envelope.profileSummary).toBe('User prefers concise replies.');
    expect(typeof envelope.toneHint).toBe('string');
  });

  it('schedule turns contain only the current task and no conversation history or profile builders', async () => {
    const host = {
      config: { persona: 'chat persona', toneAwareness: true },
      userProfiles: { buildProfileSummary: async () => 'interactive profile' },
      getTurnProvider: () => ({ name: 'openai', models: ['gpt-4o-mini'] }),
      modelRegistry: null,
      buildDisciplinedPrompt: (prompt: string) => prompt,
      getTurnActiveSkills: () => '',
      llmRuntime: { model: () => ({ id: 'gpt-4o-mini', sdk: 'openai', input: ['text'] }) },
    } as any;
    const system = createContextSystemForHost(host);
    system.addBuilder({ name: 'history-leak', build: async () => [createUserMessage('must not leak')] });

    const result = await system.buildTextTurnContext({
      host,
      turn: {
        origin: { kind: 'schedule', jobId: 'sched-1' },
        principal: { subjectId: 'owner', roles: ['trusted'] },
        session: { key: 'schedule:sched-1' },
      },
      content: 'publish report',
      turnUser: {
        rawContent: 'publish report',
        promptMessages: [createUserMessage('old conversation'),
          { ...createUserMessage('publish report', undefined, 1, { subjectId: 'old-human', authorizationRoles: ['master'] }), messageId: 'old-native' }],
      },
    });

    expect(result.userMessages).toHaveLength(1);
    const text = { type: 'text', text: result.userMessages[0]?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') };
    expect(text?.type === 'text' ? text.text : '').toContain('publish report');
    expect(text?.type === 'text' ? text.text : '').not.toContain('old conversation');
    expect(text?.type === 'text' ? text.text : '').not.toContain('interactive profile');
    expect(result.turnEnvelope).toContain('Session: origin:schedule | job_id:sched-1');
    expect(result.userMessages[0]).not.toHaveProperty('actor');
    expect(result.userMessages[0]).not.toHaveProperty('cause');
    expect(result.userMessages[0]).not.toHaveProperty('messageId');
    expect(text.text).not.toContain('old-human');
    expect(text.text).not.toContain('old-native');
  });

  it('keeps explicit current schedule metadata while discarding prebuilt history, media and native message ids', async () => {
    const host = {
      config: { persona: 'task', toneAwareness: false },
      getTurnProvider: () => ({ name: 'openai', models: ['m'] }), modelRegistry: null,
      buildDisciplinedPrompt: (prompt: string) => prompt, getTurnActiveSkills: () => '',
      llmRuntime: { model: () => ({ id: 'm', sdk: 'openai', input: ['text'] }) },
    } as any;
    const actor = { subjectId: 'schedule-owner', authorizationRoles: ['trusted'] };
    const cause = { turnId: 'schedule-exec', intent: 'new' as const };
    const current = { ...createUserMessage('previously rendered task', [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.test/old.png' } } }], 123, actor, cause), messageId: 'not-a-native-input' };
    const result = await new ContextSystem().buildTextTurnContext({ host,
      turn: { origin: { kind: 'schedule', jobId: 'job' }, principal: { subjectId: 'executor', roles: ['master'] }, session: { key: 'job' } },
      content: 'current task', turnUser: { rawContent: 'current task', promptMessages: [current] },
      prebuiltMessages: [createUserMessage('prebuilt conversation history')],
    });
    expect(result.userMessages).toHaveLength(1);
    expect(result.userMessages[0]).toMatchObject({ actor, cause, timestamp: 123 });
    expect(result.userMessages[0]).not.toHaveProperty('messageId');
    expect(result.userMessages[0]).not.toHaveProperty('media');
    const text = result.userMessages[0]!.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    expect(text).toContain('current task');
    expect(text).not.toContain('previously rendered task');
    expect(text).not.toContain('prebuilt conversation history');
    expect(text).not.toContain('executor');
  });

  it('ToneInjector respects toneAwareness config via inject pipeline', () => {
    const off = new ToneInjector({ config: { toneAwareness: false } } as any);
    const envelope: Record<string, string | undefined> = {};
    off.inject([], {
      turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'u1' })),
      inboundContent: 'angry text',
      envelope,
    });
    expect(envelope.toneHint).toBe('');

    const on = new ToneInjector({ config: { toneAwareness: true } } as any);
    const envelopeOn: Record<string, string | undefined> = {};
    on.inject([], {
      turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'u1' })),
      inboundContent: 'angry text',
      envelope: envelopeOn,
    });
    expect(typeof envelopeOn.toneHint).toBe('string');
  });

  it('ProfileContextBuilder writes profile summary into envelope via build pipeline', async () => {
    const builder = new ProfileContextBuilder({
      userProfiles: { buildProfileSummary: async () => 'profile block' },
    } as any);
    const envelope: Record<string, string | undefined> = {};
    await builder.build({
      turn: turnContextViewFromMessage(mockCommMessage({ senderId: 'u1' })),
      envelope,
    });
    expect(envelope.profileSummary).toBe('profile block');
  });

  it('createContextSystemForHost returns a new instance each call', () => {
    const host = { userProfiles: {}, config: { toneAwareness: false } } as any;
    const a = createContextSystemForHost(host);
    const b = createContextSystemForHost(host);
    expect(a).not.toBe(b);
  });
});
