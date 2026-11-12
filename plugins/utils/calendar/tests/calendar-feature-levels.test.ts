import configSchema from '../schema.json' with { type: 'json' };
import { createCalendarNotifier } from '../src/notify.js';

const target = (id: string) => ({ endpoint: { adapter: 'sandbox', id: 'main' }, kind: 'group' as const, id });

describe('calendar layered feature switch (ADR 0050 / 0055)', () => {
  it('declares all four levels and keeps the shared backend fields global', () => {
    expect(configSchema['x-zhin-config']).toEqual({ levels: ['global', 'adapter', 'endpoint', 'conversation'] });
    for (const property of Object.values(configSchema.properties)) expect(property['x-zhin-config']).toMatchObject({ levels: ['global'] });
  });

  it('does not send authorization notices to conversations where calendar is switched off', async () => {
    const sendTarget = vi.fn(async () => 'id');
    const notify = createCalendarNotifier({ sendTarget }, ({ conversation }) => conversation.id !== 'off')!;
    await notify(target('off'), 'lost', 'zh-CN');
    await notify(target('on'), 'authorized', 'en');
    expect(sendTarget.mock.calls).toEqual([[target('on'), 'authorized', { locale: 'en' }]]);
    expect(createCalendarNotifier(undefined, () => true)).toBeUndefined();
  });
});
