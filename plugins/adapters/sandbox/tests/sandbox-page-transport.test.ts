import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { sandboxText } from '../pages/index/messages.js';
import * as traces from '../pages/index/agentTrace.js';
import * as playground from '../pages/index/playgroundState.js';
import * as transport from '../pages/index/sandboxTransport.js';

const file = new URL('../pages/index/SandboxChat.tsx', import.meta.url);
const source = await readFile(file, 'utf8');
const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Sandbox') as ts.FunctionDeclaration;
const renderBoundary = declaration.body!.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === 'inlineRunCard'))!;
const prefix = source.slice(declaration.getStart(ast), renderBoundary.getStart(ast)).replace('export default ', '');
const code = ts.transpileModule(prefix + `return {locale,endpointId,canExecute,channels,messages,inputText,previewSegments,transportNotice,
  trace,traceNotice,traceLoading,currentTask,stoppingTask,showInspector,sessionKey,loadTrace,stopActiveTask,
  handleInboundPayload,handleSendMessage,sendInteractiveAction,switchChannel,addSession,setInputText,setPreviewSegments,editorRef};}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None },
}).outputText;

class FakeSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeSocket[] = [];
  readyState = 0;
  readonly frames: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  failSend = false;
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  send(payload: string) {
    if (this.failSend || this.readyState !== 1) throw new Error('socket not writable');
    this.frames.push(JSON.parse(payload));
  }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

function fixture(options: {
  fetchAgentTrace?: typeof traces.fetchAgentTrace;
  cancelAgentTask?: typeof traces.cancelAgentTask;
  loadCachedAgentTrace?: typeof traces.loadCachedAgentTrace;
  saveCachedAgentTrace?: typeof traces.saveCachedAgentTrace;
} = {}) {
  const slots: any[] = [], listeners = new Map<string, Set<() => void>>();
  let cursor = 0, pending: Array<() => void> = [], stateWrites = 0;
  const intervals = new Map<number, () => void>();
  let intervalId = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost' }, innerWidth: 1200,
    setInterval(callback: () => void) { const id = ++intervalId; intervals.set(id, callback); return id; },
    clearInterval(id: number) { intervals.delete(id); },
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    addEventListener(type: string, callback: () => void) { const items = listeners.get(type) ?? new Set(); items.add(callback); listeners.set(type, items); },
    removeEventListener(type: string, callback: () => void) { listeners.get(type)?.delete(callback); },
  });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [] })));
  const bindings = {
    sandboxText, ...traces, ...playground, ...transport,
    loadPlaygroundState: () => playground.createDefaultPlaygroundState('/workspace'),
    fetchAgentTrace: options.fetchAgentTrace ?? (async (sessionKey: string) => ({ sessionKey, latestSequence: 0, activeTurnIds: [], events: [] })),
    cancelAgentTask: options.cancelAgentTask ?? traces.cancelAgentTask,
    loadCachedAgentTrace: options.loadCachedAgentTrace ?? traces.loadCachedAgentTrace,
    saveCachedAgentTrace: options.saveCachedAgentTrace ?? traces.saveCachedAgentTrace,
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value: any) => { stateWrites++; slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial: any) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn: unknown, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) slots[index] = { deps, value: fn };
      return slots[index].value;
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  const render = Function(...Object.keys(bindings), code + '; return Sandbox;')(...Object.values(bindings));
  const f = {
    view: null as any,
    render() { cursor = 0; f.view = render(); const effects = pending; pending = []; effects.forEach(run => run()); return f.view; },
    socket: () => FakeSocket.instances.at(-1)!,
    poll() { intervals.forEach(callback => callback()); },
    get stateWrites() { return stateWrites; },
    dispatch(type: string) { listeners.get(type)?.forEach(callback => callback()); },
    ready(protocol: string | null = transport.SANDBOX_SCOPED_PROTOCOL, canExecute = true) {
      const socket = f.socket(); socket.open();
      socket.receive({ type: 'ready', id: 'owner', endpoint: 'stable-bot', connectionId: 'page-connection', protocol: protocol ?? undefined, canExecute, timestamp: 1 });
      return f.render();
    },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  f.render();
  return f;
}
const text = (value: string) => [{ type: 'text', data: { text: value } }];
const echo = (messageId: string, id = 'sandbox-user', type = 'private') => ({
  type, id, conversation: { type, id }, direction: 'inbound', messageId, senderId: 'owner', content: text('hello'), timestamp: 5,
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
const traceSnapshot = (sessionKey: string, turnId: string): traces.AgentTraceSnapshot => ({
  sessionKey, runtimeId: 'test-runtime', latestSequence: 1, activeTurnIds: [turnId],
  events: [{ sessionKey, runtimeId: 'test-runtime', turnId, sequence: 1, recordedAt: 1, type: 'turn_start', data: {} }],
});

describe('Sandbox trace and cancellation ownership', () => {
  it('displays cached trace without merging it into a new connection or its incremental cursor', async () => {
    const result = deferred<traces.AgentTraceSnapshot>();
    const fetchTrace = vi.fn<typeof traces.fetchAgentTrace>(() => result.promise);
    const saveTrace = vi.fn<typeof traces.saveCachedAgentTrace>(() => true);
    const f = fixture({
      fetchAgentTrace: fetchTrace,
      loadCachedAgentTrace: key => ({ ...traceSnapshot(key, 'cached-turn'), runtimeId: 'old-runtime', latestSequence: 8 }),
      saveCachedAgentTrace: saveTrace,
    });
    try {
      expect(f.render().trace?.events.map((event: traces.AgentTraceEvent) => event.turnId)).toEqual(['cached-turn']);
      result.resolve(traceSnapshot(f.view.sessionKey, 'fresh-turn')); await settle();
      expect(f.render().trace?.events.map((event: traces.AgentTraceEvent) => event.turnId)).toEqual(['fresh-turn']);
      expect(saveTrace.mock.calls.at(-1)?.[0]?.events.map(event => event.turnId)).toEqual(['fresh-turn']);
      f.poll(); await settle();
      expect(fetchTrace.mock.calls.at(-1)?.[1]).toBe(1);
    } finally { f.close(); }
  });

  it('ignores a slow scene A result after scene B became current', async () => {
    const requests: Array<{ key: string; signal?: AbortSignal; result: ReturnType<typeof deferred<traces.AgentTraceSnapshot>> }> = [];
    const f = fixture({ fetchAgentTrace: (key, _after, _locale, signal) => {
      const result = deferred<traces.AgentTraceSnapshot>(); requests.push({ key, signal, result }); return result.promise;
    } });
    try {
      const first = requests[0]!;
      f.view.switchChannel(f.view.channels[1]); f.render();
      const second = requests.at(-1)!;
      second.result.resolve(traceSnapshot(second.key, 'scene-B')); await settle();
      expect(f.render().currentTask?.turnId).toBe('scene-B');
      first.result.resolve(traceSnapshot(first.key, 'scene-A')); await settle();
      expect(f.render().trace?.sessionKey).toBe(second.key);
      expect(f.view.currentTask?.turnId).toBe('scene-B');
      expect(first.signal?.aborted).toBe(true);
    } finally { f.close(); }
  });

  it('coalesces polling and manual refresh behind one slow request without restarting it', async () => {
    const result = deferred<traces.AgentTraceSnapshot>();
    const fetchTrace = vi.fn<typeof traces.fetchAgentTrace>(() => result.promise);
    const f = fixture({ fetchAgentTrace: fetchTrace });
    try {
      f.poll(); f.poll(); f.poll();
      void f.view.loadTrace();
      expect(fetchTrace).toHaveBeenCalledTimes(1);
      expect(fetchTrace.mock.calls[0]?.[3]?.aborted).toBe(false);
      result.resolve(traceSnapshot(f.view.sessionKey, 'slow-but-valid')); await settle();
      expect(f.render().traceLoading).toBe(false);
      expect(f.view.currentTask?.turnId).toBe('slow-but-valid');
    } finally { f.close(); }
  });

  it('retires old connection reads even when a new Host uses the same session key', async () => {
    const requests: Array<{ key: string; result: ReturnType<typeof deferred<traces.AgentTraceSnapshot>> }> = [];
    const f = fixture({ fetchAgentTrace: key => {
      const result = deferred<traces.AgentTraceSnapshot>(); requests.push({ key, result }); return result.promise;
    } });
    try {
      const first = requests[0]!;
      f.dispatch('zhin:api-base-changed'); f.render();
      void f.view.loadTrace();
      const second = requests.at(-1)!;
      second.result.resolve(traceSnapshot(second.key, 'new-connection')); await settle();
      first.result.resolve(traceSnapshot(first.key, 'retired-connection')); await settle();
      expect(f.render().trace?.events.map((event: traces.AgentTraceEvent) => event.turnId)).toEqual(['new-connection']);
    } finally { f.close(); }
  });

  it('does not write a completed read after unmount', async () => {
    const result = deferred<traces.AgentTraceSnapshot>();
    const f = fixture({ fetchAgentTrace: () => result.promise });
    await settle();
    const key = f.view.sessionKey;
    f.close();
    const writes = f.stateWrites;
    result.resolve(traceSnapshot(key, 'after-unmount')); await settle();
    expect(f.stateWrites).toBe(writes);
  });

  it('keeps each cancellation POST bound to its scene and does not clear a newer scene stop state', async () => {
    const first = deferred<boolean>(), second = deferred<boolean>();
    const cancel = vi.fn<typeof traces.cancelAgentTask>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const f = fixture({ cancelAgentTask: cancel });
    try {
      await settle(); f.render();
      const firstKey = f.view.sessionKey, stopFirst = f.view.stopActiveTask();
      f.view.switchChannel(f.view.channels[1]); f.render(); await settle(); f.render();
      const secondKey = f.view.sessionKey, stopSecond = f.view.stopActiveTask();
      first.resolve(true); await stopFirst;
      expect(f.render().traceNotice).toBeNull();
      expect(f.view.stoppingTask).toBe(true);
      second.resolve(false); await stopSecond;
      expect(f.render().traceNotice).toBe('当前会话没有运行中的任务。');
      expect(f.view.stoppingTask).toBe(false);
      expect(cancel.mock.calls.map(([key]) => key)).toEqual([firstKey, secondKey]);
    } finally { f.close(); }
  });

  it('shows current cancellation feedback and retires its delayed refresh when the scene changes', async () => {
    vi.useFakeTimers();
    const fetchTrace = vi.fn<typeof traces.fetchAgentTrace>(async key => traceSnapshot(key, 'current'));
    const f = fixture({ fetchAgentTrace: fetchTrace, cancelAgentTask: async () => true });
    try {
      await settle(); f.render();
      await f.view.stopActiveTask();
      expect(f.render().traceNotice).toBe('已发送停止请求，正在等待任务结束。');
      f.view.switchChannel(f.view.channels[1]); f.render(); await settle(); f.render();
      const requests = fetchTrace.mock.calls.length;
      await vi.advanceTimersByTimeAsync(240);
      expect(fetchTrace).toHaveBeenCalledTimes(requests);
      expect(f.render().traceNotice).toBeNull();
    } finally { f.close(); }
  });

  it('refreshes the original current scene once after normal cancellation feedback', async () => {
    vi.useFakeTimers();
    const fetchTrace = vi.fn<typeof traces.fetchAgentTrace>(async key => traceSnapshot(key, 'current'));
    const cancel = vi.fn<typeof traces.cancelAgentTask>(async () => true);
    const f = fixture({ fetchAgentTrace: fetchTrace, cancelAgentTask: cancel });
    try {
      await settle(); f.render();
      const key = f.view.sessionKey, requests = fetchTrace.mock.calls.length;
      await f.view.stopActiveTask();
      await vi.advanceTimersByTimeAsync(240);
      expect(fetchTrace).toHaveBeenCalledTimes(requests + 1);
      expect(fetchTrace.mock.calls.at(-1)?.[0]).toBe(key);
      expect(cancel).toHaveBeenCalledExactlyOnceWith(key, 'zh-CN');
      expect(f.render().stoppingTask).toBe(false);
    } finally { f.close(); }
  });

  it.each(['scene', 'connection', 'unmount'])('ignores a cancellation error after its %s retires without retrying the POST', async (retirement) => {
    const result = deferred<boolean>();
    const cancel = vi.fn<typeof traces.cancelAgentTask>(() => result.promise);
    const f = fixture({ cancelAgentTask: cancel });
    try {
      await settle(); f.render();
      const key = f.view.sessionKey, stop = f.view.stopActiveTask();
      if (retirement === 'scene') f.view.switchChannel(f.view.channels[1]);
      else if (retirement === 'connection') f.dispatch('zhin:auth-changed');
      else f.close();
      if (retirement !== 'unmount') { f.render(); await settle(); f.render(); }
      const writes = f.stateWrites;
      result.reject(new Error('old cancellation failed')); await stop;
      expect(cancel).toHaveBeenCalledExactlyOnceWith(key, 'zh-CN');
      if (retirement === 'unmount') expect(f.stateWrites).toBe(writes);
      else {
        expect(f.render().traceNotice).toBeNull();
        expect(f.view.showInspector).toBe(false);
        expect(f.view.stoppingTask).toBe(false);
      }
    } finally { if (retirement !== 'unmount') f.close(); }
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.instances.length = 0; });

describe('Sandbox page transport boundary', () => {
  it('subscribes the current scene after ready, handles ACK as control, and switches exactly once', () => {
    const f = fixture();
    try {
      const view = f.ready(), socket = f.socket();
      expect(view.endpointId).toBe('stable-bot');
      expect(socket.frames).toEqual([{ op: 'subscribe', conversation: { type: 'private', id: 'sandbox-user' } }]);
      socket.receive({ type: 'subscribed', id: 'sandbox-user', conversation: { type: 'private', id: 'sandbox-user' }, timestamp: 2 });
      expect(f.render().messages).toEqual([]);
      view.switchChannel(view.channels[1]);
      f.render();
      expect(socket.frames).toHaveLength(2);
      expect(socket.frames[1]).toEqual({ op: 'subscribe', conversation: { type: 'group', id: 'sandbox-group' } });
      // The socket callback was created before this switch and must use the current scene ref.
      socket.receive({ type: 'ready', id: 'owner', endpoint: 'stable-bot', connectionId: 'new-connection', protocol: transport.SANDBOX_SCOPED_PROTOCOL, timestamp: 3 });
      expect(socket.frames.at(-1)).toEqual(socket.frames[1]);
    } finally { f.close(); }
  });

  it('merges the local optimistic input with repeated echoes and distinguishes the assistant and other scenes', () => {
    const f = fixture();
    try {
      const view = f.ready(), socket = f.socket();
      view.handleSendMessage('hello', text('hello'));
      const frame = socket.frames[1]!;
      expect(frame.messageId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
      socket.receive(echo(String(frame.messageId))); socket.receive(echo(String(frame.messageId)));
      expect(f.render().messages).toHaveLength(1);
      socket.receive(echo('other-page-message')); socket.receive(echo('other-page-message'));
      expect(f.render().messages.filter((message: playground.PlaygroundMessage) => message.type === 'sent')).toHaveLength(2);
      expect(socket.frames).toHaveLength(2); // Receiving a transport echo never submits another turn.
      socket.receive({ ...echo(String(frame.messageId)), direction: undefined, content: text('reply') });
      socket.receive(echo(String(frame.messageId), 'sandbox-user', 'group'));
      const messages = f.render().messages;
      expect(messages).toHaveLength(4);
      expect(messages.filter((message: playground.PlaygroundMessage) => message.id === frame.messageId).map((message: playground.PlaygroundMessage) => [message.channelType, message.type])).toEqual([
        ['private', 'sent'], ['private', 'received'], ['group', 'sent'],
      ]);
    } finally { f.close(); }
  });

  it.each(['closed', 'throws'])('preserves the editor and message list if the socket is %s before submission', (failure) => {
    const f = fixture();
    try {
      f.ready(); const socket = f.socket();
      f.view.setInputText('draft'); f.view.setPreviewSegments(text('draft'));
      const view = f.render(), clear = vi.fn(); view.editorRef.current = { clear };
      if (failure === 'closed') socket.readyState = 3; else socket.failSend = true;
      view.handleSendMessage('draft', text('draft'));
      const current = f.render();
      expect(current.inputText).toBe('draft'); expect(current.previewSegments).toEqual(text('draft'));
      expect(current.messages).toEqual([]); expect(clear).not.toHaveBeenCalled();
      expect(current.transportNotice).toBe('Sandbox 连接尚未就绪，消息未发送。');
      expect(socket.frames).toHaveLength(1);
    } finally { f.close(); }
  });

  it('does not send unknown controls to a legacy Host and retains its original message wire', () => {
    const f = fixture();
    try {
      const view = f.ready(null), socket = f.socket();
      expect(socket.frames).toEqual([]);
      socket.receive({ type: 'ready', id: 'owner', endpoint: 'legacy-bot', timestamp: 2 });
      f.render().switchChannel(view.channels[1]);
      expect(socket.frames).toEqual([]);
      f.render().handleSendMessage('legacy', text('legacy'));
      expect(socket.frames).toHaveLength(1);
      expect(socket.frames[0]).toMatchObject({ type: 'group', id: 'sandbox-group', content: text('legacy') });
      expect(f.render().transportNotice).toBeNull();
    } finally { f.close(); }
  });

  it('does not interpret approval-action echoes as another question or an accepted approval', () => {
    const f = fixture();
    try {
      f.ready(); const socket = f.socket();
      socket.receive({ ...echo('choice'), content: [{ type: 'action', data: { id: 'yes', payload: 'yes' } }] });
      expect(f.render().messages).toEqual([]);
      expect(socket.frames).toHaveLength(1);
      socket.receive({ type: 'error', id: 'sandbox-user', content: text('approval rejected'), timestamp: 2 });
      expect(f.render().transportNotice).toBe('approval rejected');
      expect(f.view.messages).toEqual([]);
    } finally { f.close(); }
  });

  it('keeps demo ready read-only even with the new protocol marker', () => {
    const f = fixture();
    try {
      const view = f.ready(transport.SANDBOX_SCOPED_PROTOCOL, false);
      view.handleSendMessage('hello', text('hello')); view.sendInteractiveAction('yes');
      expect(f.socket().frames).toEqual([]); expect(f.render().messages).toEqual([]);
      expect(f.view.canExecute).toBe(false);
    } finally { f.close(); }
  });

  it('scopes edits by the canonical conversation, preserving same-ID messages in other scenes and directions', () => {
    const f = fixture();
    try {
      f.ready(); const socket = f.socket();
      socket.receive({ ...echo('same', 'room', 'private'), direction: undefined, content: text('private') });
      socket.receive({ ...echo('same', 'room', 'group'), direction: undefined, content: text('group') });
      socket.receive({ ...echo('same', 'room', 'group'), content: text('user input') });
      socket.receive({ type: 'edit', id: 'room', conversation: { type: 'group', id: 'room' }, messageId: 'same', content: text('edited group'), timestamp: 6 });
      expect(f.render().messages.map((message: playground.PlaygroundMessage) => message.content[0]!.data.text)).toEqual(['private', 'edited group', 'user input']);
    } finally { f.close(); }
  });

  it('reconnects with a new handshake and subscription without replaying submitted input or accepting retired socket frames', async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.ready(); const first = f.socket(), stale = first.onmessage;
      f.view.handleSendMessage('once', text('once'));
      first.close(); f.render();
      await vi.advanceTimersByTimeAsync(500);
      const second = f.socket(); expect(second).not.toBe(first);
      expect(second.frames).toEqual([]);
      stale?.({ data: JSON.stringify({ ...echo('stale'), content: text('must not appear') }) });
      expect(f.render().messages).toHaveLength(1);
      f.ready();
      expect(second.frames).toEqual([{ op: 'subscribe', conversation: { type: 'private', id: 'sandbox-user' } }]);
      expect(f.render().messages).toHaveLength(1);
    } finally { f.close(); }
  });

  it('drops the old protocol capability immediately when the Host connection changes', () => {
    const f = fixture();
    try {
      f.ready(); const first = f.socket();
      f.dispatch('zhin:api-base-changed');
      const second = f.socket();
      expect(second).not.toBe(first); expect(first.readyState).toBe(3);
      expect(f.render().canExecute).toBe(false);
      second.open(); second.receive({ type: 'ready', id: 'owner', endpoint: 'legacy-bot', timestamp: 3 });
      f.render().switchChannel(f.view.channels[1]);
      expect(second.frames).toEqual([]);
      f.view.handleSendMessage('legacy', text('legacy'));
      expect(second.frames).toHaveLength(1);
      expect(second.frames[0]).not.toHaveProperty('op');
    } finally { f.close(); }
  });

  it('creates different message UUIDs at the same frozen timestamp', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    const f = fixture();
    try {
      f.ready();
      f.view.handleSendMessage('a', text('a')); f.view.handleSendMessage('b', text('b'));
      expect(new Set(f.socket().frames.filter(frame => frame.messageId).map(frame => frame.messageId)).size).toBe(2);
    } finally { f.close(); }
  });

  it('creates different new-conversation UUIDs at the same frozen timestamp', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    const f = fixture();
    try {
      f.ready();
      f.view.addSession(); f.view.addSession();
      const sessions = f.render().channels.slice(3);
      expect(sessions).toHaveLength(2); expect(sessions[0].id).not.toBe(sessions[1].id);
      expect(sessions.every((session: playground.PlaygroundSession) => session.id.startsWith('private-'))).toBe(true);
    } finally { f.close(); }
  });
});
