import { outboundMessageToken } from '@zhin.js/core/runtime';
import schema from '../schema.json' with { type: 'json' };
import plugin from '../plugin.js';
import welcome from '../handlers/welcome/index.js';
import { groupSuiteConfigFor, groupSuiteConfigStore, type GroupSuiteConfigResolver } from '../src/config.js';

const perGroup = ['welcomeMessage', 'basePointsMin', 'basePointsMax', 'streakBonus', 'streakCap', 'rankSize', 'teachMaxPerGroup', 'teachCooldownMs', 'teachPageSize'];

describe('group-suite layered feature config (ADR 0050 / 0055)', () => {
  it('opens per-group fields and keeps storage / scope / regex switches global', () => {
    expect(schema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'],
      conversationFields: perGroup, selfServiceFields: ['welcomeMessage', 'rankSize', 'teachCooldownMs', 'teachPageSize'] });
    for (const field of ['keywordReply', 'ephemeralKeywords', 'welcomeConversations', 'teachAllowRegex']) {
      expect(schema.properties[field as keyof typeof schema.properties]['x-zhin-config']).toMatchObject({ levels: ['global'] });
    }
  });

  it('provides the per-conversation resolver from setup', async () => {
    let resolver: GroupSuiteConfigResolver | undefined;
    await plugin.setup!({
      config: { get: () => ({ ephemeralKeywords: true }) },
      resources: { has: () => false, use: () => undefined, provide: (token: unknown, value: GroupSuiteConfigResolver) => { if (token === groupSuiteConfigStore) resolver = value; } },
      lifecycle: { add: () => undefined },
      configFor: (target: { conversation: { id: string } }) => ({ rankSize: target.conversation.id === 'g2' ? 3 : 10 }),
    } as never);
    const use = () => resolver!;
    const has = (token: unknown) => token === groupSuiteConfigStore;
    expect(groupSuiteConfigFor({ config: { rankSize: 10 }, has, use }, { conversation: { id: 'g2' } }).rankSize).toBe(3);
    expect(groupSuiteConfigFor({ config: { rankSize: 10 }, has, use }, undefined).rankSize).toBe(10);
  });

  it('welcomes with the group-level welcome text', async () => {
    const sent: unknown[] = [];
    const resolver: GroupSuiteConfigResolver = { configFor: target =>
      (target as { conversation: { id: string } }).conversation.id === 'g2' ? { welcomeMessage: '本群欢迎 {name}' } : {} };
    const self = {
      config: { welcomeMessage: '欢迎 {name}' }, owner: { id: 'owner' },
      has: (token: unknown) => token === groupSuiteConfigStore,
      use: (token: unknown) => token === groupSuiteConfigStore ? resolver
        : token === outboundMessageToken ? { send: async (input: { content: { data: { text: string } } }) => { sent.push(input.content.data.text); return { status: 'sent' }; } } : undefined,
    };
    for (const id of ['g1', 'g2']) {
      await (welcome.handle as (this: unknown, input: unknown) => Promise<void>).call(self, { payload: {
        name: 'notice.group.member_increase', conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group', id }, target: { id: 'u', name: 'Bob' } } });
    }
    expect(sent).toEqual(['欢迎 Bob', '本群欢迎 Bob']);
  });
});
