/**
 * #1250: the standalone `/sandbox` page must not drop a message silently while it is not
 * connected, and must not tell the user to use the bootstrap HTTP_TOKEN after Console setup.
 * The page script runs here in a minimal fake DOM.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderConsoleIndex, renderPageShell } from '../../src/shell/page-renderer.js';
import { SANDBOX_AUTH_HELP, sandboxFallbackScript } from '../../src/shell/page-renderer-helpers.js';

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
  disabled = false;
  hidden = false;
  textContent = '';
  innerHTML = '';
  value = '';
  scrollTop = 0;
  scrollHeight = 0;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly classList = { add() {}, remove() {}, toggle() {} };
  constructor(readonly id = '') {}
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type: string, event: Record<string, unknown> = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {}, ...event }); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  appendChild() {}
  querySelector() { return null; }
}

function runSandboxPage() {
  const elements = new Map<string, FakeElement>();
  const element = (id: string) => elements.get(id) ?? elements.set(id, new FakeElement(id)).get(id)!;
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static readonly OPEN = 1;
    readyState = 0;
    readonly sent: string[] = [];
    readonly listeners = new Map<string, Listener[]>();
    constructor(readonly url: string) { sockets.push(this); }
    addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    emit(type: string) {
      if (type === 'open') this.readyState = 1;
      if (type === 'close') this.readyState = 3;
      for (const listener of this.listeners.get(type) ?? []) listener({});
    }
    send(data: string) { this.sent.push(data); }
    close() {}
  }
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const source = /<script type="module">([\s\S]*)<\/script>/u.exec(sandboxFallbackScript())![1]!;
  runInNewContext(source, {
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
    },
    WebSocket: FakeSocket,
    localStorage,
    sessionStorage: localStorage,
    location: { origin: 'http://127.0.0.1:8068', search: '', pathname: '/sandbox', hash: '' },
    history: { replaceState() {} },
    window: {},
    Element: FakeElement,
    URL,
    URLSearchParams,
    JSON,
    Date,
    Math,
    Array,
    String,
  });
  return { element, sockets };
}

describe('standalone sandbox page while not connected (#1250)', () => {
  it('disables sending until the socket opens', () => {
    const { element, sockets } = runSandboxPage();
    expect(element('chat-input').disabled).toBe(true);
    expect(element('chat-send').disabled).toBe(true);
    sockets[0]!.emit('open');
    expect(element('chat-input').disabled).toBe(false);
    expect(element('chat-send').disabled).toBe(false);
    expect(element('sandbox-notice').hidden).toBe(true);
  });

  it('explains a refused connection and which token is needed', () => {
    const { element, sockets } = runSandboxPage();
    sockets[0]!.emit('error');
    sockets[0]!.emit('close');
    expect(element('ws-status').textContent).toBe('disconnected');
    expect(element('chat-send').disabled).toBe(true);
    const notice = element('sandbox-notice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('未连接到 /sandbox');
    expect(notice.textContent).toContain('API 令牌');
    expect(notice.textContent).toContain('/account');
    expect(notice.textContent).toContain('会话 → 沙盒');
  });

  it('keeps the text and says it was not sent when Enter is pressed while disconnected', () => {
    const { element, sockets } = runSandboxPage();
    sockets[0]!.emit('close');
    element('chat-input').value = '/hello';
    element('chat-form').dispatch('submit');
    expect(element('chat-input').value).toBe('/hello');
    expect(sockets[0]!.sent).toEqual([]);
    expect(element('sandbox-notice').textContent).toContain('消息没有发送');
  });

  it('sends once connected', () => {
    const { element, sockets } = runSandboxPage();
    sockets[0]!.emit('open');
    element('chat-input').value = '/hello';
    element('chat-form').dispatch('submit');
    expect(element('chat-input').value).toBe('');
    expect(sockets[0]!.sent.some(frame => JSON.parse(frame).text === '/hello')).toBe(true);
  });

  it('tells a dropped connection apart from a refused one', () => {
    const { element, sockets } = runSandboxPage();
    sockets[0]!.emit('open');
    sockets[0]!.emit('close');
    expect(element('sandbox-notice').textContent).toContain('连接已断开');
    expect(element('chat-send').disabled).toBe(true);
  });
});

describe('token box copy (#1250)', () => {
  it('asks for a Console API token, not the bootstrap HTTP_TOKEN', () => {
    const page = { title: 'Chat', route: '/sandbox', module: '/x.js', localName: 'sandbox', owner: 'root/sandbox' as never };
    for (const html of [renderPageShell(page, { runtimeSandbox: true }), renderPageShell(page), renderConsoleIndex([])]) {
      expect(html).toContain('placeholder="Console API 令牌"');
      expect(html).not.toContain('placeholder="HTTP_TOKEN');
    }
    expect(SANDBOX_AUTH_HELP).toContain('初始化后失效');
  });
});
