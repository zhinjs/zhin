import { outboundHostToken } from 'zhin.js';
import schema from '../schema.json' with { type: 'json' };
import plugin from '../plugin.js';
import { bilibiliRuntimeStore, type BilibiliRuntime } from '../src/runtime.js';

const target = (id: string) => ({ endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group' as const, id });

describe('bilibili layered feature switch (ADR 0050 / 0055)', () => {
  it('declares all four levels and keeps polling, rate limits and the cookie global', () => {
    expect(schema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'] });
    for (const property of Object.values(schema.properties)) expect(property['x-zhin-config']).toMatchObject({ levels: ['global'] });
  });

  it('does not push to conversations where bilibili is switched off', async () => {
    const sendTarget = vi.fn(async () => 'id');
    let runtime: BilibiliRuntime | undefined;
    await plugin.setup!({
      config: { get: () => ({ live: false, dynamic: false }) },
      resources: {
        has: (token: unknown) => token === outboundHostToken,
        use: () => ({ send: vi.fn(), sendTarget }),
        provide: (token: unknown, value: BilibiliRuntime) => { if (token === bilibiliRuntimeStore) runtime = value; },
      },
      lifecycle: { add: () => undefined },
      signal: new AbortController().signal,
      isEnabledFor: ({ conversation }: { conversation: { id: string } }) => conversation.id !== 'off',
    } as never);
    const base = { adapterName: 'sandbox', endpointKey: 'bot', channelType: 'group' as const, content: 'live!' };
    await runtime!.outbound!({ ...base, target: target('off'), channelId: 'off' });
    await runtime!.outbound!({ ...base, target: target('on'), channelId: 'on' });
    expect(sendTarget.mock.calls.map(call => (call[0] as { id: string }).id)).toEqual(['on']);
  });
});
