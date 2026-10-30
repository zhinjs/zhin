import { expect, it, vi } from 'vitest';
import { createWorkspaceDirectoryController } from '../pages/index/workspaceDirectoryState.js';
import type { WorkspaceDirectory } from '../pages/index/workspaceDirectory.js';
import { createDefaultPlaygroundState } from '../pages/index/playgroundState.js';

const scene = createDefaultPlaygroundState().sessions[0]!;
const scope = { endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, endpointKey: 'bot', ownerId: 'owner', connectionId: 'connection-A' };
const directory: WorkspaceDirectory = { scope, items: [] };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('keeps an empty server catalog empty and never writes as a consequence of ready or a read', async () => {
  const loaded = vi.fn(), save = vi.fn(), status = vi.fn();
  const controller = createWorkspaceDirectoryController({ loaded, status, read: async () => directory, save });
  await controller.begin({ host: 'A', connectionId: scope.connectionId, canExecute: true });
  expect(loaded).toHaveBeenCalledWith(directory, false);
  expect(save).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith({ mode: 'server', error: null });
});

it('only restores in-memory selection for the same Host, canonical endpoint, and server owner', async () => {
  const loaded = vi.fn();
  const read = vi.fn().mockResolvedValue(directory);
  const controller = createWorkspaceDirectoryController({ loaded, status: vi.fn(), read });
  await controller.begin({ host: 'A', connectionId: 'connection-A', canExecute: true });
  read.mockResolvedValue({ ...directory, scope: { ...scope, connectionId: 'connection-B', endpointKey: 'random-new-name' } });
  await controller.begin({ host: 'A', connectionId: 'connection-B', canExecute: true });
  expect(loaded.mock.calls.at(-1)?.[1]).toBe(true);
  await controller.begin({ host: 'B', connectionId: 'connection-B', canExecute: true });
  expect(loaded.mock.calls.at(-1)?.[1]).toBe(false);
  read.mockResolvedValue({ ...directory, scope: { ...scope, ownerId: 'other-owner' } });
  await controller.begin({ host: 'B', connectionId: 'connection-A', canExecute: true });
  expect(loaded.mock.calls.at(-1)?.[1]).toBe(false);
});

it('retires a slow old Host read and does not substitute browser data for a binding/store error', async () => {
  const slow = deferred<WorkspaceDirectory | null>(), loaded = vi.fn(), status = vi.fn();
  const read = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(directory).mockRejectedValueOnce(Error('binding unknown'));
  const controller = createWorkspaceDirectoryController({ loaded, status, read });
  const old = controller.begin({ host: 'old', connectionId: scope.connectionId, canExecute: true });
  await controller.begin({ host: 'new', connectionId: scope.connectionId, canExecute: true });
  slow.resolve({ ...directory, items: [{ ...scene, name: 'old Host', revision: 'old', updatedAt: 1 }] });
  await old;
  expect(loaded).toHaveBeenCalledTimes(1);
  await controller.refresh();
  expect(loaded).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith({ mode: 'error', error: 'binding unknown' });
});

it('uses the existing browser path for an old Host, explicit unavailable store, or demo without fetching full-only data', async () => {
  const read = vi.fn().mockResolvedValue(null), loaded = vi.fn(), status = vi.fn();
  const controller = createWorkspaceDirectoryController({ loaded, status, read });
  await controller.begin({ host: 'A', canExecute: true });
  expect(read).not.toHaveBeenCalled();
  await controller.begin({ host: 'A', connectionId: 'legacy-store', canExecute: true });
  expect(read).toHaveBeenCalledTimes(1);
  await controller.begin({ host: 'A', connectionId: 'demo', canExecute: false });
  expect(read).toHaveBeenCalledTimes(1);
  expect(loaded.mock.calls.every(call => call[0] === null)).toBe(true);
  expect(status).toHaveBeenLastCalledWith({ mode: 'browser', error: null });
});

it('serializes each scene, coalesces unsent metadata, and uses the returned revision for the next write', async () => {
  const first = deferred<{ scope: typeof scope; item: WorkspaceDirectory['items'][number] }>();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (_id, input) => ({ scope, item: { ...input, revision: 'revision-2', updatedAt: 2 } }));
  const controller = createWorkspaceDirectoryController({ loaded: vi.fn(), status: vi.fn(), read: async () => directory, save });
  await controller.begin({ host: 'A', connectionId: scope.connectionId, canExecute: true });
  const writing = controller.save(scene); await Promise.resolve();
  void controller.save({ ...scene, name: 'intermediate' });
  void controller.save({ ...scene, name: 'latest' });
  expect(save).toHaveBeenCalledTimes(1);
  first.resolve({ scope, item: { ...scene, revision: 'revision-1', updatedAt: 1 } });
  await writing;
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]).toEqual([scope.connectionId, { ...scene, name: 'latest' }, 'revision-1', { apiBase: 'A', headers: {} }]);
  await controller.save(scene, true);
  expect(save).toHaveBeenCalledTimes(2);
});

it('does not replay unknown writes, queued changes, or mutations after retiring the socket', async () => {
  const pending = deferred<never>(), save = vi.fn().mockReturnValueOnce(pending.promise);
  const status = vi.fn();
  const controller = createWorkspaceDirectoryController({ loaded: vi.fn(), status, read: async () => directory, save });
  await controller.begin({ host: 'A', connectionId: scope.connectionId, canExecute: true });
  const writing = controller.save(scene); await Promise.resolve();
  void controller.save({ ...scene, name: 'queued change' });
  pending.reject(Error('write outcome unknown')); await writing;
  await controller.save({ ...scene, name: 'do not retry' });
  await controller.save(scene, true);
  expect(save).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith({ mode: 'server', error: 'write outcome unknown' });
  const later = deferred<never>(); save.mockReturnValueOnce(later.promise);
  await controller.refresh();
  const retired = controller.save(scene); await Promise.resolve();
  void controller.save({ ...scene, name: 'old queue' });
  controller.retire();
  const writes = status.mock.calls.length;
  later.reject(Error('old response')); await retired;
  expect(status).toHaveBeenCalledTimes(writes);
  expect(save).toHaveBeenCalledTimes(2);
});

it('pins actual reads and queued PUTs to the owner Host and credentials before a storage event retires it', async () => {
  const values = new Map([['zhin_api_base', 'https://host-a.invalid'], ['zhin_api_token', 'synthetic-token-A']]);
  vi.stubGlobal('window', { location: { origin: 'http://console.invalid' } });
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
  const first = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ success: true, data: directory }))
    .mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json({ success: true, data: { scope, item: { ...scene, revision: 'r2', updatedAt: 2 } } }));
  vi.stubGlobal('fetch', fetchMock);
  const status = vi.fn();
  try {
    const controller = createWorkspaceDirectoryController({ loaded: vi.fn(), status });
    await controller.begin({ host: 'https://host-a.invalid', connectionId: scope.connectionId, canExecute: true });
    const writing = controller.save(scene); await Promise.resolve();
    void controller.save({ ...scene, name: 'queued metadata' });
    // Another page changed these values; its storage event has not run in this page yet.
    values.set('zhin_api_base', 'https://host-b.invalid');
    values.set('zhin_api_token', 'synthetic-token-B');
    first.resolve(Response.json({ success: true, data: { scope, item: { ...scene, revision: 'r1', updatedAt: 1 } } }));
    await writing;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://host-a.invalid');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token-A');
    }
    expect(JSON.stringify(status.mock.calls)).not.toContain('synthetic-token');
    controller.retire();
  } finally { vi.unstubAllGlobals(); }
});
