import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHttpHost } from '@zhin.js/host-http';
import { GenerationAdmissionGate, SnapshotStore, generationAdmissionSource, pluginDataMigrationProviderToken,
  rootPluginId, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { OwnerApprovalRuntime } from '@zhin.js/agent/security';
import { createOwnerApprovalMigrationProvider } from '../../../src/plugin-runtime/data-migration/owner-approval-provider.js';
import { registerDataMigrationRoutes } from '../../../src/plugin-runtime/console/data-migration-routes.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'zhin-migration-http-'));
  const root = rootPluginId(), admission = new GenerationAdmissionGate();
  const file = path.join(projectRoot, 'data', 'owner-approve-always.json');
  await mkdir(path.dirname(file));
  const original = JSON.stringify({ version: 2, endpoints: { 'icqq|old-name|owner': { bashAlways: true, bashRules: [] } } });
  await writeFile(file, original);
  const approvals = new OwnerApprovalRuntime(projectRoot);
  const preview = vi.spyOn(approvals, 'previewHistoricalApprovals');
  const provider = createOwnerApprovalMigrationProvider({ approvals, admission });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: projectRoot, children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[root, new Map<TokenId, unknown>([[pluginDataMigrationProviderToken.id, provider]])]]) };
  const snapshots = new SnapshotStore(state);
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  registerDataMigrationRoutes({ http, base: '/api', projectRoot, snapshots });
  const { port } = await http.listen();
  cleanups.push(async () => { await snapshots.close(); await http.close(); await rm(projectRoot, { recursive: true, force: true }); });
  const request = (suffix = '', input?: unknown, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/data-migrations${suffix}`, {
    ...(input === undefined ? {} : { method: 'POST', body: typeof input === 'string' ? input : JSON.stringify(input) }),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  return { root, request, provider, preview, original, file, admission, snapshots, state };
}

it('authenticates before inspecting records or parsing an untrusted command', async () => {
  const f = await fixture();
  expect((await f.request(`?owner=${f.root}`, undefined, 'demo')).status).toBe(403);
  expect((await f.request('/commands', '{invalid', 'demo')).status).toBe(403);
  expect((await f.request('', undefined, 'unknown')).status).toBe(401);
  expect(f.preview).not.toHaveBeenCalled();
});
it('lists the real owner and previews historical grants without rewriting or activating them', async () => {
  const f = await fixture();
  const providers = await f.request(); expect(providers.status).toBe(200);
  expect((await providers.json()).data).toEqual([{ owner: f.root, title: 'Owner approval history' }]);
  const response = await f.request(`?owner=${f.root}`); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).data.candidates).toMatchObject([{ executable: false, status: 'unresolved',
    summary: { requiresFreshAuthorization: true } }]);
  expect(await readFile(f.file, 'utf8')).toBe(f.original);
  expect(f.provider[generationAdmissionSource]).toEqual([f.admission]);
});
it('rejects caller-supplied plans, filesystem paths and ambiguous selectors', async () => {
  const f = await fixture();
  for (const input of [{ action: 'apply', planId: '../private' }, { action: 'apply', planId: 'fake', plan: { grant: true } },
    { action: 'prepare', owner: f.root, candidateId: 'old', expectedDigest: 'sha', target: {} },
    { action: 'resume', planId: 'fake', principalId: 'admin' }]) {
    expect((await f.request('/commands', input)).status).toBe(400);
  }
  expect((await f.request(`?owner=${f.root}&planId=fake`)).status).toBe(400);
  expect((await f.request(`?owner=${f.root}&owner=${f.root}`)).status).toBe(400);
  expect(await readFile(f.file, 'utf8')).toBe(f.original);
});
it('does not treat a malformed body or a missing plan as a migration success', async () => {
  const f = await fixture();
  expect((await f.request('/commands', '{invalid')).status).toBe(400);
  const response = await f.request('?planId=00000000-0000-0000-0000-000000000001');
  expect(response.status).toBe(404); expect((await response.json()).code).toBe('not_found');
});
