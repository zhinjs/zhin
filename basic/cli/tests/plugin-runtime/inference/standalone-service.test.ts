import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openHeadlessInferenceHost } from '../../../src/plugin-runtime/inference/headless-host.js';

it('creates, renames and deletes a standalone Service through the real built-in plan schema without credentials or discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inference-standalone-service-'));
  const opened = await openHeadlessInferenceHost({ projectRoot: root,
    database: { dialect: 'sqlite', filename: ':memory:' }, resolveSource: vi.fn() });
  const held = opened.host.acquireManagement();
  const principal = { ownerId: opened.host.hostOwnerId, hostAdministrator: true };
  const fetch = vi.spyOn(globalThis, 'fetch');
  const credential = vi.spyOn(opened.host.repository, 'readCredential');
  try {
    const driver = { id: 'openai', owner: 'root', contractVersion: '1' };
    const first = await held.management.review(principal, { plan: { version: 1, services: {
      new: { driver, options: {}, models: {}, label: 'First name' },
    } } });
    expect(await held.management.apply(principal, { prepared: first.prepared, mutationId: 'create-service' })).toMatchObject({ status: 'committed' });
    const id = first.bindings!.services.new;
    let graph = (await opened.host.repository.readGraph({ rootId: root }))!;
    expect(graph.services[id]).toMatchObject({ label: 'First name', models: {}, options: { baseUrl: 'https://api.openai.com/v1' } });
    expect(graph.accounts).toEqual({}); expect(graph.profiles).toEqual({});
    const renamed = await held.management.review(principal, { plan: { version: 1, services: {
      [id]: { driver, options: graph.services[id].options, models: {}, label: 'Renamed' },
    } }, bindings: { services: { [id]: id } } });
    expect(await held.management.apply(principal, { prepared: renamed.prepared, mutationId: 'rename-service' })).toMatchObject({ status: 'committed' });
    graph = (await opened.host.repository.readGraph({ rootId: root }))!;
    expect(graph.services[id].label).toBe('Renamed');
    const removed = await held.management.review(principal, { plan: { version: 1, remove: { services: [id] } } });
    expect(await held.management.apply(principal, { prepared: removed.prepared, mutationId: 'delete-service' })).toMatchObject({ status: 'committed' });
    expect((await opened.host.repository.readGraph({ rootId: root }))!.services).toEqual({});
    expect(credential).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); await held.release(); await opened.close(); await rm(root, { recursive: true, force: true }); }
});
