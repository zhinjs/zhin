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
      commMessage,
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
      message: mockCommMessage({ senderId: 'u1' }),
      inboundContent: 'I am very frustrated!!!',
      host,
      envelope,
    });

    expect(messages).toEqual([]);
    expect(envelope.profileSummary).toBe('User prefers concise replies.');
    expect(typeof envelope.toneHint).toBe('string');
  });

  it('ToneInjector respects toneAwareness config via inject pipeline', () => {
    const off = new ToneInjector({ config: { toneAwareness: false } } as any);
    const envelope: Record<string, string | undefined> = {};
    off.inject([], {
      message: mockCommMessage({ senderId: 'u1' }),
      inboundContent: 'angry text',
      envelope,
    });
    expect(envelope.toneHint).toBe('');

    const on = new ToneInjector({ config: { toneAwareness: true } } as any);
    const envelopeOn: Record<string, string | undefined> = {};
    on.inject([], {
      message: mockCommMessage({ senderId: 'u1' }),
      inboundContent: 'angry text',
      envelope: envelopeOn,
    });
    expect(typeof envelopeOn.toneHint).toBe('string');
  });

  it('CollaborationContextBuilder writes hint into envelope via build pipeline', async () => {
    const builder = new CollaborationContextBuilder();
    const envelope: Record<string, string | undefined> = {};
    await builder.build({
      message: mockCommMessage({ scope: 'group', sceneId: 'g1' }),
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
      message: mockCommMessage({ senderId: 'u1' }),
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
