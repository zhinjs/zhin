import { describe, expect, it, vi } from 'vitest';
import {
  createTurnIngress,
  type ReplyPort,
  type TurnIngressInput,
} from '../../src/turn/turn-ingress.js';

function input(overrides: Partial<TurnIngressInput> = {}): TurnIngressInput {
  const reply: ReplyPort = {
    send: vi.fn(async () => ({ status: 'sent' as const })),
  };
  return {
    identity: {
      rootId: 'root',
      generation: 7,
      traceId: 'trace-1',
      turnId: 'turn-1',
    },
    origin: {
      kind: 'im',
      platform: 'telegram',
      endpoint: 'work-bot',
      scope: 'group',
      sceneId: 'group-42',
      messageId: 'message-9',
    },
    principal: {
      subjectId: 'user-1',
      displayName: 'Ada',
      roles: ['trusted'],
    },
    input: {
      text: 'summarize this',
      media: [{ kind: 'image', source: { kind: 'url', value: 'https://example.test/a.png' } }],
      metadata: { mentioned: true },
    },
    session: { key: 'im:telegram:work-bot:group:group-42' },
    policy: { permissions: ['trusted'], unattended: false },
    capabilities: { tools: ['web_search'], skills: ['summarize'] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, reply },
    ...overrides,
  };
}

describe('TurnIngress', () => {
  it('publishes an immutable Agent-owned turn while preserving scoped port identity', () => {
    const source = input();
    const turn = createTurnIngress(source);

    expect(turn).toMatchObject({
      origin: { kind: 'im', platform: 'telegram', sceneId: 'group-42' },
      principal: { subjectId: 'user-1', roles: ['trusted'] },
      session: { key: 'im:telegram:work-bot:group:group-42' },
      input: { text: 'summarize this' },
    });
    expect(turn.ports.reply).toBe(source.ports.reply);
    expect(turn.signal).toBe(source.signal);
    expect(Object.isFrozen(turn)).toBe(true);
    expect(Object.isFrozen(turn.origin)).toBe(true);
    expect(Object.isFrozen(turn.principal.roles)).toBe(true);
    expect(Object.isFrozen(turn.input.media?.[0]?.source)).toBe(true);
    expect(Object.isFrozen(turn.policy.permissions)).toBe(true);
    expect(Object.isFrozen(turn.capabilities.tools)).toBe(true);
    expect('$adapter' in turn).toBe(false);
    expect('$reply' in turn).toBe(false);
  });

  it('fails closed when identity or session ownership is missing', () => {
    expect(() => createTurnIngress(input({
      identity: { rootId: '', generation: 7, traceId: 'trace-1', turnId: 'turn-1' },
    }))).toThrow('TurnIngress identity.rootId is required');
    expect(() => createTurnIngress(input({ session: { key: '' } })))
      .toThrow('TurnIngress session.key is required');
  });

  it('requires unattended turns to omit every interactive port', () => {
    expect(() => createTurnIngress(input({
      policy: { permissions: [], unattended: true },
    }))).toThrow('Unattended TurnIngress cannot expose interactive ports');
  });
});
