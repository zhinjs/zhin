import { describe, expect, it, vi } from 'vitest';
import * as ai from '@zhin.js/ai';
import { createUserMessage } from '@zhin.js/ai';
import {
  ContextSystem,
  ToneInjector,
  CollaborationContextBuilder,
  ProfileContextBuilder,
  createContextSystemForHost,
} from '../../src/context/context-system.js';
import type { ContextBuilder } from '../../src/context/contracts.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { turnContextViewFromMessage } from '../../src/context/im-turn-context-adapter.js';

describe('ContextSystem', () => {
  it('buildTextTurnContext merges registered builder messages and injectors', async () => {
    vi.spyOn(ai, 'getLlmTransportModel').mockReturnValue({ id: 'gpt-4o-mini', sdk: 'openai' } as any);
    const host = {
      config: { persona: 'p', toneAwareness: false },
      userProfiles: { buildProfileSummary: async () => '' },
      getTurnProvider: () => ({ name: 'openai', models: ['gpt-4o-mini'] }),
      modelRegistry: null,
      buildDisciplinedPrompt: (p: string) => p,
      getTurnActiveSkills: () => '',
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
    vi.spyOn(ai, 'getLlmTransportModel').mockReturnValue({ id: 'gpt-4o-mini', sdk: 'openai' } as any);
    const host = {
      config: { persona: 'chat persona', toneAwareness: true },
      userProfiles: { buildProfileSummary: async () => 'interactive profile' },
      getTurnProvider: () => ({ name: 'openai', models: ['gpt-4o-mini'] }),
      modelRegistry: null,
      buildDisciplinedPrompt: (prompt: string) => prompt,
      getTurnActiveSkills: () => '',
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
        promptMessages: [createUserMessage('old conversation'), createUserMessage('publish report')],
      },
    });

    expect(result.userMessages).toHaveLength(1);
    const text = result.userMessages[0]?.content.find(block => block.type === 'text');
    expect(text?.type === 'text' ? text.text : '').toContain('publish report');
    expect(text?.type === 'text' ? text.text : '').not.toContain('old conversation');
    expect(text?.type === 'text' ? text.text : '').not.toContain('interactive profile');
    expect(result.turnEnvelope).toContain('Session: origin:schedule | job_id:sched-1');
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

  it('CollaborationContextBuilder writes hint into envelope via build pipeline', async () => {
    const builder = new CollaborationContextBuilder();
    const envelope: Record<string, string | undefined> = {};
    await builder.build({
      turn: turnContextViewFromMessage(mockCommMessage({ scope: 'group', sceneId: 'g1' })),
      inboundContent: 'status',
      envelope,
    });
    expect(envelope.collaborationHint === undefined || typeof envelope.collaborationHint === 'string').toBe(true);
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
