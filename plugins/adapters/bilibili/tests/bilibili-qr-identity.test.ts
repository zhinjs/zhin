import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { defineAdapter, type EndpointCreationContext, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/bilibili/index.js';
import { bilibiliNotifierToken } from '../src/bilibili-runtime-state.js';
import { BilibiliStateFiles, writeJsonAtomic } from '../src/storage.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from '../src/protocol.js';
import { BilibiliAdapter } from '../src/adapter.js';
import { BilibiliEndpoint } from '../src/endpoint.js';

const directories: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function fixture(old: 'stored' | 'unknown' | 'unbound', cancelBeforeCommit = false) {
  const dir = mkdtempSync(join(tmpdir(), 'bili-identity-')); directories.push(dir);
  const config: BilibiliEndpointConfig = { id: 'bili', dataDir: dir, videos: [], ...(old === 'unknown' ? { sessdata: 'expired-fixture' } : {}) };
  const files = new BilibiliStateFiles(dir, 'bili');
  if (old === 'stored') writeJsonAtomic(files.credentialsFile, { sessdata: 'expired-fixture', biliJct: 'old-fixture', mid: '99' }, 0o600);
  const canonicalId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili');
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [{ instanceId: 'old-instance', canonicalId, endpointId: 'bili', revision: 1, desiredEnabled: true, config }] };
  const compareAndSet = vi.fn<EndpointDesiredRepository['compareAndSet']>(async (_id, expected, endpoints, commitId) => {
    expect(expected).toBe(state.revision); state = structuredClone({ revision: state.revision + 1, endpoints, commitId }); return state;
  });
  const repository: EndpointDesiredRepository = { load: async () => state, compareAndSet };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input), cookie = new Headers(init?.headers).get('Cookie') ?? '';
    let data: unknown, code = 0;
    if (url.includes('/qrcode/generate')) data = { url: 'https://example.test/qr', qrcode_key: 'offline-fixture' };
    else if (url.includes('/qrcode/poll')) data = { code: 0, url: 'https://example.test/login?SESSDATA=new-fixture&bili_jct=new-jct&DedeUserID=4242' };
    else if (url.includes('/nav')) { if (cookie.includes('SESSDATA=new-fixture')) data = { isLogin: true, mid: 4242 }; else { code = -101; data = { isLogin: false }; } }
    else throw new Error('Unexpected offline Bilibili request');
    return new Response(JSON.stringify({ code, data }));
  });
  vi.stubGlobal('fetch', fetch);
  class CancelingAdapter extends BilibiliAdapter {
    protected override createEndpoint(input: BilibiliEndpointConfig, context: EndpointCreationContext): BilibiliEndpoint {
      const endpoint = new BilibiliEndpoint({ id: context.canonicalId, signal: context.signal, autoPoll: false,
        config: resolveBilibiliConfig(input), configuration: input, stateDir: dir,
        reconcileLogin: login => {
          const committing = this.acceptVerifiedLogin(context, login);
          // The synchronous cancellation precedes the queued beforeCommit microtask.
          endpoint.cancelQrLogin(); return committing;
        },
      });
      return endpoint;
    }
  }
  const entry = cancelBeforeCommit ? defineAdapter<BilibiliEndpointConfig>({ capabilities: ['inbound', 'outbound'],
    createAdapter: context => new CancelingAdapter(context) }) : definition;
  const harness = await createAdapterHarness(entry, config, { name: 'bilibili', repository,
    resources: new Map([[bilibiliNotifierToken.id, async () => false]]) });
  await harness.start(); harness.open();
  const endpoint = harness.endpoint!;
  return { harness, endpoint, files, compareAndSet, canonicalId, fetch, state: () => state };
}
describe('Bilibili QR credentials reconcile the original account through the real Adapter', () => {
  it('replaces an expired previously verified account before persisting new QR cookies', async () => {
    const f = await fixture('stored');
    try {
      expect(f.endpoint.login.state).toBe('expired');
      await f.endpoint.startQrLogin(); await f.endpoint.pollQrLoginOnce();
      expect(f.state().endpoints[0]).toMatchObject({ desiredEnabled: false, config: { sessdata: 'new-fixture' } });
      expect(f.state().endpoints[0].instanceId).not.toBe('old-instance');
      expect(f.state().endpoints[0].canonicalId).not.toBe(f.canonicalId);
      expect(existsSync(f.files.credentialsFile)).toBe(false);
      expect(f.endpoint.login.state).not.toBe('ok');
    } finally { await f.harness.stop(); }
  });
  it('does not treat unverifiable existing credentials as an unbound account', async () => {
    const f = await fixture('unknown');
    try {
      await f.endpoint.startQrLogin(); await f.endpoint.pollQrLoginOnce();
      expect(f.endpoint.qrLogin.state).toBe('failed'); expect(f.compareAndSet).not.toHaveBeenCalled();
      expect(f.state().endpoints[0].instanceId).toBe('old-instance');
      expect(existsSync(f.files.credentialsFile)).toBe(false);
    } finally { await f.harness.stop(); }
  });
  it('does not save a QR result canceled while its read-only identity check is pending', async () => {
    const f = await fixture('unbound');
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const original = f.fetch.getMockImplementation()!;
    f.fetch.mockImplementation(async (input, init) => {
      if (String(input).includes('/nav')) { enter(); await pending; }
      return original(input, init);
    });
    try {
      await f.endpoint.startQrLogin(); const polling = f.endpoint.pollQrLoginOnce();
      await entered; f.endpoint.cancelQrLogin(); resume(); await polling;
      expect(f.endpoint.qrLogin.state).toBe('idle'); expect(f.compareAndSet).not.toHaveBeenCalled();
      expect(existsSync(f.files.credentialsFile)).toBe(false);
      expect(f.endpoint.login.state).toBe('none');
    } finally { resume(); await f.harness.stop(); }
  });
  it('binds a genuinely unbound account without retiring its Client', async () => {
    const f = await fixture('unbound');
    try {
      await f.endpoint.startQrLogin(); await f.endpoint.pollQrLoginOnce();
      expect(f.endpoint.login).toMatchObject({ state: 'ok', mid: '4242' });
      expect(f.harness.endpoint).toBe(f.endpoint); expect(f.state().endpoints[0].instanceId).toBe('old-instance');
      expect(JSON.parse(readFileSync(f.files.credentialsFile, 'utf8'))).toMatchObject({ mid: '4242', sessdata: 'new-fixture' });
    } finally { await f.harness.stop(); }
  });
  it('does not commit credentials canceled after reconcile admission but before the queued CAS', async () => {
    const f = await fixture('unbound', true);
    try {
      await f.endpoint.startQrLogin(); await f.endpoint.pollQrLoginOnce();
      expect(f.endpoint.qrLogin.state).toBe('idle'); expect(f.compareAndSet).not.toHaveBeenCalled();
      expect(f.state().endpoints[0].config).not.toHaveProperty('sessdata');
      expect(existsSync(f.files.credentialsFile)).toBe(false);
    } finally { await f.harness.stop(); }
  });
});
