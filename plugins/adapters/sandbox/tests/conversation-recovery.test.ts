import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as recovery from '../pages/index/conversationRecovery.js';
import { captureSandboxRequestContext, type SandboxRequestContext } from '../pages/index/sandboxTransport.js';
import { sandboxText } from '../pages/index/messages.js';
import { createDefaultPlaygroundState, PLAYGROUND_STORAGE_KEY } from '../pages/index/playgroundState.js';

const file = new URL('../pages/index/ConversationRecoveryPanel.tsx', import.meta.url);
const source = await readFile(file, 'utf8');
const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ConversationRecoveryPanel') as ts.FunctionDeclaration;
const boundary = component.body!.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === 'results'))!;
// Capture the production handlers without changing their logic or rendering path.
const body = source.slice(component.getStart(ast), boundary.getStart(ast))
  + 'captureHandlers({reloadPending,reloadResults,earlier});\n' + source.slice(boundary.getStart(ast), component.end);
const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;

interface Element { type: unknown; props: Record<string, any>; }
const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: { ...props, children } });
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('type' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
const content = (value: unknown): string => Array.isArray(value) ? value.map(content).join('')
  : value && typeof value === 'object' && 'props' in value ? content((value as Element).props.children)
    : typeof value === 'string' ? value : '';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
}

function fixture(options: { connectionId?: string; sessionKey?: string; requestContext?: SandboxRequestContext;
  legacyState?: ReturnType<typeof createDefaultPlaygroundState> } = {}) {
  const slots: any[] = [];
  let cursor = 0, effects: (() => void)[] = [], dirty = false, writes = 0;
  const requests: { url: URL; init: RequestInit; response: ReturnType<typeof deferred<Response>> }[] = [];
  const storage = new Map([['zhin_api_base', 'https://host-a.invalid'], ['zhin_api_token', 'synthetic-a']]);
  if (options.legacyState) storage.set(PLAYGROUND_STORAGE_KEY, JSON.stringify(options.legacyState));
  vi.stubGlobal('window', { location: { origin: 'https://console.invalid' } });
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  vi.stubGlobal('fetch', vi.fn((url: string | URL, init: RequestInit = {}) => {
    const response = deferred<Response>(); requests.push({ url: new URL(url), init, response }); return response.promise;
  }));
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        writes++; if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback(fn: unknown, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) slots[index] = { deps, fn };
      return slots[index].fn;
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  let handlers!: { reloadPending: () => Promise<void>; reloadResults: () => Promise<void>; earlier: () => Promise<void> };
  const renderedInteractions = vi.fn((segments, id, submitted, onSubmitted) => createElement('interaction', { segments, id, submitted, onSubmitted }));
  const props = { connectionId: options.connectionId ?? 'connection-A', sessionKey: options.sessionKey ?? 'sandbox:bot:group:room',
    locale: 'zh-CN', requestContext: options.requestContext, pendingRefreshEpoch: 0, renderInteraction: renderedInteractions };
  const bindings = { React: { createElement }, ...hooks, ...recovery, captureSandboxRequestContext, sandboxText,
    MarkdownContent: 'markdown', captureHandlers: (value: typeof handlers) => { handlers = value; } };
  const exports: Record<string, any> = {};
  Function('exports', ...Object.keys(bindings), code)(exports, ...Object.values(bindings));
  const f = {
    view: null as unknown,
    requests, storage, props, renderedInteractions,
    get handlers() { return handlers; }, get writes() { return writes; },
    render() {
      let count = 0;
      do {
        if (++count > 30) throw Error('Recovery render did not settle');
        dirty = false; cursor = 0; f.view = exports.default(props);
        const pending = effects; effects = []; pending.forEach(effect => effect());
      } while (dirty);
      return f.view;
    },
    async settle() { for (let index = 0; index < 15; index++) { await Promise.resolve(); f.render(); } },
    respond(index: number, data: unknown, status = 200) {
      requests[index]!.response.resolve(new Response(JSON.stringify({ success: status < 400, ...(status < 400 ? { data } : { error: data }) }), { status }));
    },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
    all(type: string) { return elements(f.view).filter(element => element.type === type); },
  };
  f.render();
  return f;
}

const result = (turnId: string, status: recovery.RecoveredDelivery['status'] = 'not_sent', deliveryUnknown?: true): recovery.RecoveredResult => ({
  turnId, completedAt: Number(turnId.replace(/\D/gu, '')) || 1, message: `output ${turnId}`,
  deliveries: [{ status, ...(deliveryUnknown ? { deliveryUnknown } : {}), recordedAt: 1, messages: [], resources: [] }],
});
const page = (sessionKey: string, results: recovery.RecoveredResult[], hasMore = false, nextCursor: string | null = null) => ({ sessionKey, results, hasMore, nextCursor });
const prompt = (id = 'prompt-A') => ({ id, generation: 1, subjectId: 'owner', expiresAt: Date.now() + 1000,
  segments: [{ type: 'keyboard', data: { rows: [[{ label: '允许一次', payload: 'server-action' }]] } }] });
afterEach(() => vi.unstubAllGlobals());

it('initial recovery performs only authenticated no-store reads and does not fabricate an interaction from browser cache', async () => {
  const legacy = createDefaultPlaygroundState();
  const f = fixture({ legacyState: { ...legacy, messages: [{ id: 'old-keyboard', type: 'received',
    channelType: legacy.sessions[0]!.type, channelId: legacy.sessions[0]!.id, channelName: 'legacy', senderId: 'endpoint', senderName: 'endpoint',
    content: prompt('cached-forgery').segments, timestamp: 1 }] } });
  try {
    expect(f.requests.map(request => request.url.pathname)).toEqual(['/api/interactions/pending', '/api/conversations/results']);
    for (const request of f.requests) {
      expect(request.init.method ?? 'GET').toBe('GET'); expect(request.init.cache).toBe('no-store');
      expect(request.url.searchParams.get('connectionId')).toBe('connection-A'); expect(request.url.searchParams.get('sessionKey')).toBe(f.props.sessionKey);
    }
    expect(f.renderedInteractions).not.toHaveBeenCalled();
    f.respond(0, { generation: 1, pending: [] }); f.respond(1, page(f.props.sessionKey, [])); await f.settle();
    expect(f.view).toBeNull(); expect(f.renderedInteractions).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(2);
    expect(f.storage.has(PLAYGROUND_STORAGE_KEY)).toBe(true);
  } finally { f.close(); }
});

it('submitting a server-projected interaction marks submission and reloads pending without executing or retrying a task', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [prompt()] }); f.respond(1, page(f.props.sessionKey, [])); await f.settle();
    const action = f.all('interaction')[0]!;
    expect(action.props.id).toBe('prompt-A'); expect(action.props.submitted).toBe(false);
    action.props.onSubmitted(); f.render();
    expect(f.all('interaction')[0]?.props.submitted).toBe(true);
    expect(f.requests).toHaveLength(3); expect(f.requests[2]?.url.pathname).toBe('/api/interactions/pending');
    expect(f.requests.every(request => (request.init.method ?? 'GET') === 'GET')).toBe(true);
    f.respond(2, { generation: 1, pending: [] }); await f.settle(); expect(f.all('interaction')).toEqual([]);
  } finally { f.close(); }
});

it('keeps a raced submission disabled until an explicit successful authority read finds that same claim still valid', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [prompt()] }); f.respond(1, page(f.props.sessionKey, [])); await f.settle();
    f.all('interaction')[0]!.props.onSubmitted(); f.render();
    f.respond(2, { generation: 1, pending: [prompt()] }); await f.settle();
    expect(f.all('interaction')[0]!.props.submitted).toBe(true);
    const reread = f.all('button').find(element => content(element.props.children) === '重新读取');
    expect(reread).toBeDefined();
    reread!.props.onClick();
    f.respond(3, { generation: 1, pending: [prompt()] }); await f.settle();
    expect(f.all('interaction')[0]!.props.submitted).toBe(false);
    expect(f.requests.filter(request => request.url.pathname.endsWith('/results'))).toHaveLength(1);
    expect(f.requests.every(request => (request.init.method ?? 'GET') === 'GET')).toBe(true);
  } finally { f.close(); }
});

it('a settlement event replaces an already in-flight read and cannot restore its stale prompt', async () => {
  const f = fixture();
  try {
    f.props.pendingRefreshEpoch++; f.render();
    expect(f.requests).toHaveLength(3);
    expect(f.requests[0]!.init.signal?.aborted).toBe(true);
    expect(f.requests[1]!.init.signal?.aborted).toBe(false);
    expect(f.requests[2]!.url.pathname).toBe('/api/interactions/pending');
    f.respond(0, { generation: 1, pending: [prompt('retired-read')] });
    f.respond(1, page(f.props.sessionKey, [])); f.respond(2, { generation: 1, pending: [] }); await f.settle();
    expect(f.all('interaction')).toEqual([]);
  } finally { f.close(); }
});

it('refreshes after a normal text answer follow-up without submitting any recovered callback or reloading results', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [prompt('text-question')] }); f.respond(1, page(f.props.sessionKey, [])); await f.settle();
    f.props.pendingRefreshEpoch++; f.render();
    expect(f.requests).toHaveLength(3);
    f.respond(2, { generation: 1, pending: [] }); await f.settle();
    expect(f.all('interaction')).toEqual([]);
    expect(f.requests.filter(request => request.url.pathname.endsWith('/results'))).toHaveLength(1);
  } finally { f.close(); }
});

it('retires delayed old-owner reads on unmount and keeps a new scene isolated', async () => {
  const old = fixture(); old.close(); const writes = old.writes;
  const current = fixture({ connectionId: 'connection-B', sessionKey: 'sandbox:bot:group:other-room' });
  try {
    current.respond(0, { generation: 2, pending: [] }); current.respond(1, page(current.props.sessionKey, [result('new-2')])); await current.settle();
    old.respond(0, { generation: 1, pending: [prompt('old')] }); old.respond(1, page(old.props.sessionKey, [result('old-1')]));
    await current.settle();
    expect(old.writes).toBe(writes);
    expect(old.requests.every(request => request.init.signal?.aborted)).toBe(true);
    expect(current.all('markdown').map(element => element.props.text)).toEqual(['output new-2']);
    expect(current.renderedInteractions).not.toHaveBeenCalled();
  } finally { current.close(); }
});

it('gives unknown delivery precedence over a partial prefix and hides fully sent output from offline recovery', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [] });
    f.respond(1, page(f.props.sessionKey, [result('sent-1', 'sent'), result('partial-2', 'partial', true), result('not-sent-3')]));
    await f.settle();
    expect(f.all('markdown').map(element => element.props.text)).toEqual(['output partial-2', 'output not-sent-3']);
    expect(f.all('summary').map(element => content(element.props.children))).toEqual([
      expect.stringContaining('已完成，投递结果未知'), expect.stringContaining('已完成，未投递'),
    ]);
  } finally { f.close(); }
});

it('uses the opaque earlier cursor and serializes same-owner page loading with refresh while retaining fifty newest results', async () => {
  const f = fixture(), opaque = 'opaque/%中文+cursor';
  try {
    const newest = Array.from({ length: 50 }, (_, index) => result(`turn-${index + 10}`));
    f.respond(0, { generation: 1, pending: [] }); f.respond(1, page(f.props.sessionKey, newest, true, opaque)); await f.settle();
    expect(f.all('details')).toHaveLength(50);
    const earlier = f.handlers.earlier();
    void f.handlers.reloadResults(); void f.handlers.earlier();
    expect(f.requests).toHaveLength(3); expect(f.requests[2]?.url.searchParams.get('cursor')).toBe(opaque);
    f.respond(2, page(f.props.sessionKey, [result('turn-1'), { ...result('turn-10'), message: 'older duplicate must not replace current' }]));
    await earlier; await f.settle();
    expect(f.all('details')).toHaveLength(51);
    expect(f.all('markdown').map(element => element.props.text)).not.toContain('older duplicate must not replace current');
    expect(f.all('markdown')[0]?.props.text).toBe('output turn-1');
  } finally { f.close(); }
});

it('keeps errors visible and separate from empty or unsupported reads, and retries only GET', async () => {
  const f = fixture();
  try {
    f.respond(0, 'pending read failed', 503); f.respond(1, 'result read failed', 503); await f.settle();
    expect(f.all('p').filter(element => element.props.role === 'alert').map(element => content(element.props.children)))
      .toEqual([expect.stringContaining('pending read failed'), expect.stringContaining('result read failed')]);
    const retry = f.handlers.reloadResults();
    expect(f.requests[2]?.url.pathname).toBe('/api/conversations/results'); expect(f.requests[2]?.init.method ?? 'GET').toBe('GET');
    f.respond(2, page(f.props.sessionKey, [])); await retry; await f.settle();
    expect(f.all('p').filter(element => element.props.role === 'alert')).toHaveLength(1);
  } finally { f.close(); }
  const unsupported = fixture();
  try {
    unsupported.respond(0, 'not found', 404); unsupported.respond(1, 'not allowed', 405); await unsupported.settle();
    expect(unsupported.view).toBeNull(); expect(unsupported.requests).toHaveLength(2);
  } finally { unsupported.close(); }
});

it('rejects another-session result page instead of rendering it as current output', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [] }); f.respond(1, page('sandbox:bot:group:other', [result('wrong-1')])); await f.settle();
    expect(f.all('markdown')).toEqual([]);
    expect(f.all('p').some(element => element.props.role === 'alert')).toBe(true);
  } finally { f.close(); }
});

it('pins later recovery requests to the original Host and header snapshot before a global scope event arrives', async () => {
  const f = fixture();
  try {
    f.respond(0, { generation: 1, pending: [prompt()] }); f.respond(1, page(f.props.sessionKey, [result('turn-2')], true, 'older')); await f.settle();
    const headers = f.requests[0]!.init.headers;
    f.storage.set('zhin_api_base', 'https://host-b.invalid'); f.storage.set('zhin_api_token', 'synthetic-b');
    const loading = f.handlers.earlier(); f.all('interaction')[0]!.props.onSubmitted();
    expect(f.requests.slice(2).map(request => request.url.origin)).toEqual(['https://host-a.invalid', 'https://host-a.invalid']);
    expect(f.requests.slice(2).every(request => request.init.headers === headers)).toBe(true);
    f.respond(2, page(f.props.sessionKey, [])); f.respond(3, { generation: 1, pending: [] }); await loading; await f.settle();
  } finally { f.close(); }
});
