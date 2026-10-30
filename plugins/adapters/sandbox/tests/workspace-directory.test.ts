import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readWorkspaceDirectory, saveWorkspaceConversation } from '../pages/index/workspaceDirectory.js';
import { DEFAULT_SANDBOX_AGENT_RUN_CONFIG } from '../src/run-config.js';

const scope = { endpoint: { adapter: 'sandbox', id: 'root/sandbox/bot' }, endpointKey: 'bot', ownerId: 'owner', connectionId: 'connection-A' };
const conversation = { id: 'room & + %25', type: 'group' as const, name: 'Shared conversation', runConfig: DEFAULT_SANDBOX_AGENT_RUN_CONFIG };
const item = { ...conversation, revision: 'revision-1', updatedAt: 1 };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { origin: 'http://console.invalid' } });
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'zhin_api_base' ? 'http://host.invalid' : null });
});
afterEach(() => vi.unstubAllGlobals());

it('reads an actual empty catalog without treating it as legacy data to migrate', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { scope, items: [] } }));
  expect(await readWorkspaceDirectory(scope.connectionId)).toEqual({ scope, items: [] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetchMock.mock.calls[0]![0]));
  expect(url.origin).toBe('http://host.invalid');
  expect(url.searchParams.get('connectionId')).toBe(scope.connectionId);
});

it.each([404, 405])('uses browser fallback for an old Host without the route (%s)', async status => {
  fetchMock.mockResolvedValue(new Response('old route', { status }));
  expect(await readWorkspaceDirectory(scope.connectionId)).toBeNull();
});

it('only falls back for explicitly unavailable storage, preserving binding and database errors', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ code: 'workspace_store_unavailable' }, { status: 503 }));
  expect(await readWorkspaceDirectory(scope.connectionId)).toBeNull();
  for (const code of ['sandbox_binding_unavailable', 'workspace_store_error']) {
    fetchMock.mockResolvedValueOnce(Response.json({ success: false, code, error: 'lookup failed' }, { status: 503 }));
    await expect(readWorkspaceDirectory(scope.connectionId)).rejects.toMatchObject({ status: 503, code });
  }
});

it('does not turn a denied, malformed, or mismatched response into an empty catalog', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'denied' }, { status: 403 }));
  await expect(readWorkspaceDirectory(scope.connectionId)).rejects.toMatchObject({ status: 403 });
  fetchMock.mockResolvedValueOnce(new Response('<html>proxy fallback</html>'));
  await expect(readWorkspaceDirectory(scope.connectionId)).rejects.toThrow();
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: { scope: { ...scope, connectionId: 'old-connection' }, items: [] } }));
  await expect(readWorkspaceDirectory(scope.connectionId)).rejects.toThrow('different connection');
});

it('writes only explicit metadata with its expected revision and no browser message history', async () => {
  fetchMock.mockResolvedValue(Response.json({ success: true, data: { scope, item } }));
  expect(await saveWorkspaceConversation(scope.connectionId, { ...conversation, unread: 9 } as typeof conversation, null)).toEqual({ scope, item });
  const init = fetchMock.mock.calls[0]![1]!;
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ connectionId: scope.connectionId, conversation, expectedRevision: null });
});

it.each(['conflict', 'unknown'])('does not retry a revision conflict or unknown write (%s)', async kind => {
  if (kind === 'conflict') fetchMock.mockResolvedValue(Response.json({ success: false, code: 'revision_conflict', error: 'changed elsewhere' }, { status: 409 }));
  else fetchMock.mockRejectedValue(new TypeError('connection ended after send'));
  await expect(saveWorkspaceConversation(scope.connectionId, conversation, 'revision-0')).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
