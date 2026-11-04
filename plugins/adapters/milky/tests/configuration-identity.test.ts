import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/milky/index.js';

/** Identity verification goes through the actual Adapter and Index; no platform request leaves the process. */
async function fixture(response: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(response), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(definition, {
    id: 'synthetic', connection: 'webhook', baseUrl: 'https://synthetic.invalid', path: '/events', access_token: 'synthetic-old',
  }, { name: 'milky', repository, resources: new Map([[httpHostToken.id, http]]) });
  await h.start(); h.open();
  const original = h.adapter.list()[0]!;
  const endpoint = h.adapter.getEndpoint(original.instanceId);
  return { ...h, fetch, repository, original, endpoint,
    update: () => h.adapter.patchConfiguration(original.instanceId, h.adapter.revision, { access_token: 'synthetic-new' }),
    async cleanup() { await h.stop(); await http.close(); vi.unstubAllGlobals(); },
  };
}

it.each([
  { name: 'contradictory success', disposition: 'unknown', response: { status: 'ok', retcode: -400, data: { uin: 12345 } } },
  { name: 'explicit rejection', disposition: 'rejected', response: { status: 'failed', retcode: -400, message: 'synthetic rejection', data: { uin: 12345 } } },
  { name: 'contradictory rejection', disposition: 'unknown', response: { status: 'failed', retcode: 0, data: { uin: 12345 } } },
  { name: 'missing retcode', disposition: 'unknown', response: { status: 'ok', data: { uin: 12345 } } },
  { name: 'string retcode', disposition: 'unknown', response: { status: 'ok', retcode: '0', data: { uin: 12345 } } },
])('never saves or reconnects after $name during account identity verification', async ({ response, disposition }) => {
  const h = await fixture(response);
  try {
    await expect(h.update()).rejects.toMatchObject({ code: 'unavailable', cause: { disposition } });
    expect(h.repository.writes).toHaveLength(0);
    expect(h.adapter.getEndpoint(h.original.instanceId)).toBe(h.endpoint);
    expect(h.adapter.list()[0]!.epoch).toBe(h.original.epoch);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(new URL(String(h.fetch.mock.calls[0]![0])).pathname).toBe('/api/get_login_info');
  } finally { await h.cleanup(); }
});

it('preserves the account identity and reconnects once after confirmed matching identity responses', async () => {
  const h = await fixture({ status: 'ok', retcode: 0, data: { uin: 12345 } });
  try {
    await expect(h.update()).resolves.toMatchObject({ execution: { status: 'applied' } });
    expect(h.repository.writes).toHaveLength(1);
    expect(h.adapter.list()[0]!.instanceId).toBe(h.original.instanceId);
    expect(h.adapter.list()[0]!.epoch).toBe(h.original.epoch + 1);
    expect(h.adapter.getEndpoint(h.original.instanceId)).not.toBe(h.endpoint);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  } finally { await h.cleanup(); }
});
