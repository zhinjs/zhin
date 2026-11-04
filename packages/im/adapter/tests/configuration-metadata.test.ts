import { describe, expect, it } from 'vitest';
import { createAdapterConsoleRpc, type AdapterConsoleSpec } from '../src/index.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

const fields = [{ key: 'token', env: true }, { key: 'baseUrl' }, { key: 'label' }] as const;
const spec: AdapterConsoleSpec = { adapterKey: 'demo', adapterDisplayName: 'Demo', fields };

describe('account URL metadata at the actual Console boundary', () => {
  it.each(['url', 'baseUrl', 'apiBaseUrl', 'http_url', 'api_url', 'signApiAddr', 'accessTokenUrl', 'gatewayUrl', 'gatewayFaultProxyUrl'])(
    'masks credentials in the declared %s URL without constructing a Client or changing desired configuration', async key => {
      const f = await accountRuntimeFixture();
      const url = 'wss://gateway.example/events?access_token=synthetic-url-secret&version=1';
      await f.adapter.add(f.adapter.revision, { endpointId: 'bot', config: { id: 'bot', [key]: url } });
      const rpc = createAdapterConsoleRpc({ ...spec, fields: [{ key }] });
      const status = await rpc.methods.get('status')!.handler({}, f.call());
      expect(status).toMatchObject({ configured: [{ id: 'bot', values: { [key]: '••••••' } }] });
      expect(JSON.stringify(status)).not.toContain('synthetic-url-secret');
      expect(f.repository.state.get(f.adapter.descriptor.id)!.endpoints[0]!.config[key]).toBe(url);
      expect(f.adapter.created).toHaveLength(0);
    },
  );

  it.each([
    'https://synthetic-user:synthetic-password@example.test/api',
    'ws://synthetic-user@example.test/events',
    'https://example.test/api?api_key=synthetic-query-key',
    'https://example.test/api?Authorization=synthetic-query-key',
    'https://example.test/api?%61ccess_token=synthetic-query-key',
    'https://example.test/api?X-Amz-Signature=synthetic-query-key',
    'https://example.test/api?token=&token=synthetic-query-key',
    'https://example.test/api#access_token=synthetic-fragment-key',
  ])('masks a credential-bearing URL through runtime and read-only status: %s', async baseUrl => {
    const f = await accountRuntimeFixture();
    await f.adapter.add(f.adapter.revision, { endpointId: 'bot', config: { id: 'bot', baseUrl } });
    const runtimeRpc = createAdapterConsoleRpc(spec);
    const readOnlyRpc = createAdapterConsoleRpc({ ...spec, getConfig: () => ({ endpoints: [{ id: 'bot', baseUrl }] }) });
    for (const status of [await runtimeRpc.methods.get('status')!.handler({}, f.call()),
      await readOnlyRpc.methods.get('status')!.handler({}, { signal: new AbortController().signal })]) {
      expect(status).toMatchObject({ configured: [{ id: 'bot', values: { baseUrl: '••••••' } }] });
      expect(JSON.stringify(status)).not.toContain(baseUrl);
    }
  });

  it('does not interpret ordinary messages, paths or non-authentication query names as credentials', async () => {
    const f = await accountRuntimeFixture();
    const config = { id: 'bot', baseUrl: 'https://example.test/api?version=1&tokenizer=fast&monkey=banana&keyspace=public#public-anchor',
      message: 'https://example.test/?access_token=ordinary-message-text', path: '/events?token=ordinary-route-text',
      defaultActivity: { url: 'https://synthetic-user:synthetic-password@example.test/activity' },
      plainUrl: 'relative/path?token=ordinary-relative-path' };
    await f.adapter.add(f.adapter.revision, { endpointId: 'bot', config });
    const rpc = createAdapterConsoleRpc({ ...spec, fields: ['baseUrl', 'message', 'path', 'defaultActivity.url', 'plainUrl'].map(key => ({ key })) });
    const status = await rpc.methods.get('status')!.handler({}, f.call());
    expect(status).toMatchObject({ configured: [{ values: { baseUrl: config.baseUrl, message: config.message, path: config.path,
      'defaultActivity.url': '••••••', plainUrl: config.plainUrl } }] });
  });

  it('preserves an omitted masked URL during patch and rejects using its placeholder as a new credential', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    const baseUrl = 'https://synthetic-user:synthetic-password@example.test/api?api_key=synthetic-key';
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic-token', baseUrl, label: 'before' } }), call);
    const row = f.adapter.list()[0]!;
    expect(await rpc.methods.get('status')!.handler({}, call)).toMatchObject({ configured: [{ values: { token: '••••••', baseUrl: '••••••', label: 'before' } }] });
    await rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { label: 'after' } }), call);
    expect(f.repository.state.get(f.adapter.descriptor.id)!.endpoints[0]!.config).toMatchObject({ baseUrl, label: 'after', token: 'synthetic-token' });
    const writes = f.repository.compareAndSet.mock.calls.length;
    await expect(rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { baseUrl: '••••••' } }), call)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(rpc.methods.get('endpoint-replace')!.handler(f.request({ instanceId: row.instanceId, id: 'new', values: { token: 'synthetic-new-token', baseUrl: '••••••' } }), call)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(writes);
    expect(f.adapter.list()[0]!.instanceId).toBe(row.instanceId);
    expect(f.repository.state.get(f.adapter.descriptor.id)!.endpoints[0]!.config.baseUrl).toBe(baseUrl);
    expect(f.adapter.created).toHaveLength(0);
  });
});
