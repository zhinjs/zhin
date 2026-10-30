import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as state from '../pages/index/playgroundState.js';
import * as transport from '../pages/index/sandboxTransport.js';
import * as messages from '../pages/index/messages.js';
import { mergeSandboxHistory, readSandboxHistoryPage, type SandboxHistoryBinding } from '../pages/index/useSandboxHistory.js';

const binding: SandboxHistoryBinding = { connectionId: 'socket-1', sessionKey: 'sandbox:bot:group:room',
  scope: { adapter: 'sandbox', id: 'canonical' }, scene: { id: 'room', type: 'group', name: 'Project' }, ownerId: 'owner' };
const conversation = { endpoint: binding.scope, kind: 'group', id: 'room' };
const text = (value: string) => [{ type: 'text', data: { text: value } }];
const created = (sequence: number, id: string, content = text(id), actor?: { id: string; displayName?: string }) => ({
  sequence, type: 'message.created', timestamp: sequence, message: { ref: { conversation, id }, timestamp: sequence, segments: content, ...(actor ? { actor } : {}) },
});
const page = (items: unknown[], hasMore = false) => ({ success: true, data: { conversation, items, hasMore,
  nextBeforeSequence: hasMore ? (items[0] as { sequence: number })?.sequence : null } });
const live = (id: string, value = id): state.PlaygroundMessage => ({ id, type: 'received', channelType: 'group', channelId: 'room',
  channelName: 'Project', senderId: 'endpoint', senderName: 'Bot', content: text(value), timestamp: 100 });
afterEach(() => vi.unstubAllGlobals());

const code = ts.transpileModule(readFileSync(new URL('../pages/index/useSandboxHistory.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Execute production hook/effect handlers and fetch ownership without replacing the lifecycle logic. */
function fixture() {
  const slots: any[] = [], calls: any[] = [], updaters: ((previous: readonly state.PlaygroundMessage[]) => state.PlaygroundMessage[])[] = [];
  const storage = new Map([['zhin_api_base', 'https://host-a'], ['zhin_api_token', 'token-a']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  vi.stubGlobal('window', { location: { origin: 'https://console.example' } });
  vi.stubGlobal('fetch', vi.fn((url: URL, init: RequestInit) => new Promise(resolve => { calls.push({ url, init, resolve }); })));
  let cursor = 0, dirty = false, effects: (() => void)[] = [], current: SandboxHistoryBinding | undefined = { ...binding }, output: any;
  let rows: state.PlaygroundMessage[] = [], defer = false;
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const hooks = {
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [slots[i], (next: any) => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(initial: unknown) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useCallback(fn: unknown, deps: unknown[]) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const i = cursor++; if (!same(slots[i]?.deps, deps)) {
      const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const compiled = { exports: {} as typeof import('../pages/index/useSandboxHistory.js') };
  const imports: Record<string, unknown> = { react: hooks, './playgroundState.js': state, './sandboxTransport.js': transport, './messages.js': messages };
  new Function('require', 'exports', 'module', code)((name: string) => imports[name], compiled.exports, compiled);
  const f = {
    calls, storage, updaters,
    get rows() { return rows; }, set rows(value) { rows = value; },
    get binding() { return current; }, set binding(value) { current = value; },
    get output() { return output; },
    deferUpdates() { defer = true; },
    render() { let count = 0; do {
      if (++count > 30) throw Error('history hook must settle'); dirty = false; cursor = 0;
      output = compiled.exports.useSandboxHistory(current, updater => { if (defer) updaters.push(updater); else rows = updater(rows); }, 'en');
      const pending = effects; effects = []; pending.forEach(run => run());
    } while (dirty); return output; },
    async settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty || effects.length) this.render(); } },
    answer(index: number, body: unknown, status = 200) { calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); },
    close() { for (const slot of slots) slot?.cleanup?.(); },
  };
  f.render(); return f;
}

it('loads one real page and only loads older non-message events when requested, without sending inputs', async () => {
  const f = fixture();
  expect(f.calls).toHaveLength(1); expect(f.calls[0].url.searchParams.get('connectionId')).toBe('socket-1');
  expect(f.calls[0].init).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer token-a' } });
  f.answer(0, page(Array.from({ length: 50 }, (_, i) => ({ sequence: i + 51, timestamp: 1, type: 'member.joined' })), true));
  await f.settle(); expect(f.rows).toEqual([]); expect(f.calls).toHaveLength(1); expect(f.output.hasMore).toBe(true);
  const first = f.output.loadEarlier(); const duplicate = f.output.loadEarlier(); expect(first).toBe(duplicate);
  expect(f.calls[1].url.searchParams.get('beforeSequence')).toBe('51');
  f.rows = [live('during-read')];
  f.answer(1, page([created(1, 'old', text('stored output'))])); await first; await f.settle();
  expect(f.rows.map(row => row.id)).toEqual(['old', 'during-read']); expect(f.output.hasMore).toBe(false);
  await f.output.loadEarlier(); expect(f.calls).toHaveLength(2);
  expect(f.calls.every(call => !call.init.method && !call.init.body)).toBe(true);
  f.close();
});

it.each(['socket', 'scene', 'owner', 'canonical', 'Host'])('retires an old %s read and ignores late completion', async change => {
  const f = fixture(), first = f.binding!;
  if (change === 'Host') f.storage.set('zhin_api_base', 'https://host-b');
  else if (change === 'socket') f.binding = { ...first, connectionId: 'socket-2' };
  else if (change === 'scene') f.binding = { ...first, scene: { ...first.scene, id: 'other-room' }, sessionKey: 'sandbox:bot:group:other-room' };
  else if (change === 'owner') f.binding = { ...first, ownerId: 'new-owner' };
  else f.binding = { ...first, scope: { ...first.scope, id: 'new-canonical' } };
  f.render(); expect(f.calls[0].init.signal.aborted).toBe(true);
  f.answer(0, page([created(1, 'STALE')])); await f.settle(); expect(f.rows).toEqual([]);
  f.close();
});

it('a deferred merge cannot apply after its owner retires and old-socket requests never borrow new Host credentials', async () => {
  const f = fixture(); f.deferUpdates();
  f.answer(0, page([created(1, 'stored')])); await f.settle(); expect(f.updaters).toHaveLength(1);
  const context = transport.captureSandboxRequestContext();
  f.storage.set('zhin_api_base', 'https://host-b'); f.storage.set('zhin_api_token', 'token-b');
  await f.output.refresh(); expect(f.calls).toHaveLength(1);
  expect(f.updaters[0]([live('current')]).map(row => row.id)).toEqual(['current']);
  f.binding = { ...f.binding!, connectionId: 'late-old-ready', requestContext: context }; f.render();
  expect(f.calls).toHaveLength(1);
  f.close();
});

it('read failures preserve live rows and a named missing-history response differs from unsupported or failed lookup', async () => {
  const f = fixture(); f.rows = [live('live')];
  f.answer(0, { code: 'history_not_recorded' }, 404); await f.settle();
  expect(f.output.error).toBeNull(); expect(f.rows).toHaveLength(1);
  const refresh = f.output.refresh(); f.answer(1, { code: 'history_unavailable', error: 'source unavailable' }, 503);
  await refresh; await f.settle(); expect(f.output.error).toBe('source unavailable'); expect(f.rows).toHaveLength(1);
  expect(f.calls).toHaveLength(2); f.close();
});

it('rejects canonical endpoint, topic, message address or cursor mismatch but retains other real actors', () => {
  const other = created(1, 'other-user', text('hello'), { id: 'other-person', displayName: 'Other member' });
  expect(readSandboxHistoryPage(page([other]), binding).messages[0]).toMatchObject({ senderId: 'other-person', senderName: 'Other member' });
  for (const changes of [{ endpoint: { ...conversation.endpoint, id: 'other' } }, { id: 'other-room' }, { threadId: 'unexpected' }]) {
    const value = page([created(1, 'id')]); Object.assign(value.data, { conversation: { ...conversation, ...changes } });
    expect(() => readSandboxHistoryPage(value, binding)).toThrow();
  }
  const wrongMessage = created(1, 'id'); wrongMessage.message.ref.conversation = { ...conversation, id: 'other' };
  expect(() => readSandboxHistoryPage(page([wrongMessage]), binding)).toThrow();
  expect(() => readSandboxHistoryPage(page([created(7, 'id')]), binding, 7)).toThrow();
  expect(() => readSandboxHistoryPage({ success: true, data: { ...page([created(1, 'id')], true).data, nextBeforeSequence: 2 } }, binding)).toThrow();
});

it('joins native ids without replacing live edits, sorts stable history ties, and retains recalls across earlier pages', () => {
  const keyboard = [{ type: 'keyboard', data: { rows: [[{ label: 'old', payload: 'old' }]] } }];
  const read = readSandboxHistoryPage(page([created(1, 'native', keyboard), { sequence: 2, type: 'message.recalled', timestamp: 2,
    messageRef: { conversation, id: 'older' } }]), binding).messages;
  const current = { ...live('native', 'live edit'), interactionReadOnly: false };
  const first = mergeSandboxHistory([current, live('new-live')], read);
  expect(first.filter(row => row.id === 'native')).toHaveLength(1);
  expect(first.find(row => row.id === 'native')).toMatchObject({ content: text('live edit'), interactionReadOnly: false });
  const earlier = readSandboxHistoryPage(page([created(1, 'older', keyboard)]), binding).messages;
  const merged = mergeSandboxHistory(first, earlier);
  expect(merged.find(row => row.id === 'older')).toMatchObject({ recalled: true, interactionReadOnly: true });
  expect(mergeSandboxHistory(merged, read)).toEqual(merged);
});

it('old browser keyboard controls, including nested forwards, are read-only without inventing a submitted choice', () => {
  const initial = state.createDefaultPlaygroundState(), source = { ...live('cached'), channelType: 'private', channelId: initial.sessions[0]!.id };
  for (const content of [[{ type: 'keyboard', data: {} }], [{ type: 'forward', data: { entries: [{ segments: [{ type: 'keyboard', data: {} }] }] } }]]) {
    const loaded = state.loadPlaygroundState({ getItem: () => JSON.stringify({ ...initial, messages: [{ ...source, content, interactionReadOnly: false }] }), setItem() {} });
    expect(loaded.messages[0]).toMatchObject({ interactionReadOnly: true });
    expect(loaded.messages[0]).not.toHaveProperty('interactionResolved');
  }
  const ordinary = state.loadPlaygroundState({ getItem: () => JSON.stringify({ ...initial, messages: [source] }), setItem() {} });
  expect(ordinary.messages[0]).not.toHaveProperty('interactionReadOnly');
});
