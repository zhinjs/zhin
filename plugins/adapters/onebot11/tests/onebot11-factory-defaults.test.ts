import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { httpHostToken } from '@zhin.js/host-http';
import { onebot11RuntimeStateToken } from '../src/onebot11-runtime-state.js';

const created = vi.hoisted(() => ({ ws: [] as unknown[], wss: [] as unknown[] }));

vi.mock('../src/ws-endpoint.js', () => ({
  OneBot11WsEndpoint: class { constructor(options: unknown) { created.ws.push(options); } },
}));
vi.mock('../src/wss-endpoint.js', () => ({
  OneBot11WssEndpoint: class { constructor(options: unknown) { created.wss.push(options); } },
}));

function contextFor(config: Record<string, unknown>) {
  return {
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'onebot11'),
    name: 'onebot11',
    config,
    use: (token: unknown) => {
      if (token === httpHostToken) return {};
      if (token === onebot11RuntimeStateToken) return { endpoints: new Map() };
      throw new Error(`unexpected token: ${String(token)}`);
    },
  } as never;
}

describe('onebot11 adapter factory defaults', () => {
  it('enables probeLoginInfo for ws and wss endpoints', async () => {
    const { default: adapter } = await import('../adapters/onebot11/index.js');
    adapter.create(contextFor({ connection: 'ws', id: 'a', url: 'ws://127.0.0.1:6700' }));
    adapter.create(contextFor({ connection: 'wss', id: 'b', path: '/onebot/ws' }));
    expect(created.ws[0]).toMatchObject({ probeLoginInfo: true });
    expect(created.wss[0]).toMatchObject({ probeLoginInfo: true });
  });
});
