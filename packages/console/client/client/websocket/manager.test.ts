import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApplyConsoleEvent = vi.fn(async () => undefined);

vi.mock("../persistence/idb-store.js", () => ({
  applyConsoleEvent: (...args: unknown[]) => mockApplyConsoleEvent(...args),
}));

import { WebSocketManager } from "./manager.js";
import { ConnectionState, type WebSocketMessage } from "./types.js";

function mockStorage(map: Record<string, string> = {}): Storage {
  return {
    getItem: (key: string) => map[key] ?? null,
    setItem: (key: string, value: string) => {
      map[key] = value;
    },
    removeItem: (key: string) => {
      delete map[key];
    },
    clear: () => {
      for (const key of Object.keys(map)) delete map[key];
    },
    key: () => null,
    length: 0,
  };
}

function installBrowserGlobals(storage: Storage = mockStorage()) {
  const win = {
    location: { origin: "http://localhost:5173", protocol: "http:", host: "localhost:5173" },
    __ZHIN_API_TOKEN: undefined as string | undefined,
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", mockStorage());
  return { win, storage };
}

function sseResponse(status = 200, body?: ReadableStream<Uint8Array> | null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body === undefined
      ? new ReadableStream<Uint8Array>({
        start(controller) {
          // Keep the stream open until abort; tests control lifecycle via disconnect().
          void controller;
        },
      })
      : body,
    json: async () => ({}),
  } as Response;
}

function eventHistoryResponse(items: unknown[] = [], runtimeId = 'runtime-test', latestEventId?: number) {
  const inferredLatest = (items.at(-1) as { eventId?: number } | undefined)?.eventId ?? 0;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        runtimeId,
        items,
        oldestAvailableEventId: items.length ? 1 : null,
        latestEventId: latestEventId ?? inferredLatest,
        nextAfter: inferredLatest,
        hasMore: false,
        gap: false,
      },
    }),
  } as Response;
}

function mockConsoleTransport(sse: () => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    return String(input).includes('/api/events/history') ? eventHistoryResponse() : await sse();
  });
}

describe("WebSocketManager REST/SSE transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApplyConsoleEvent.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("connects SSE without a token (local Host with empty TokenRegistry)", async () => {
    installBrowserGlobals();
    const fetchMock = mockConsoleTransport(() => sseResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager({ reconnectInterval: 100, maxReconnectAttempts: 3 });
    const states: boolean[] = [];
    manager.onConnectionChange((c) => states.push(c));
    manager.connect();

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
    const sseCall = fetchMock.mock.calls.find(([input]) => !String(input).includes('/history'))!;
    const init = sseCall[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers.Authorization).toBeUndefined();
    expect(manager.getState()).toBe(ConnectionState.CONNECTED);
    expect(manager.isConnected()).toBe(true);
    manager.disconnect();
  });

  it("sends Authorization when a token is stored", async () => {
    installBrowserGlobals(mockStorage({ zhin_api_token: "secret" }));
    const fetchMock = mockConsoleTransport(() => sseResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const sseCall = fetchMock.mock.calls.find(([input]) => !String(input).includes('/history'))!;
    const init = sseCall[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    manager.disconnect();
  });

  it("reconnects after a transient SSE failure (no ERROR deadlock)", async () => {
    installBrowserGlobals();
    let sseCalls = 0;
    const fetchMock = mockConsoleTransport(() => {
      sseCalls += 1;
      if (sseCalls === 1) return sseResponse(503, null);
      return sseResponse(200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager({
      reconnectInterval: 100,
      maxReconnectAttempts: 5,
    });
    manager.connect();

    // First attempt fails → RECONNECTING
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getState()).toBe(ConnectionState.RECONNECTING);
    expect(sseCalls).toBe(1);

    // scheduleReconnect delay = 100 * attempt(1) = 100ms
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(sseCalls).toBeGreaterThanOrEqual(2);
    expect(manager.getState()).toBe(ConnectionState.CONNECTED);
    manager.disconnect();
  });

  it("sendRequest posts without Authorization when no token is stored", async () => {
    installBrowserGlobals();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { yaml: "http:\n  port: 1\n" } }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager();
    const data = await manager.getConfigYaml();
    expect(data.yaml).toContain("port");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.method).toBe("POST");
  });

  it("sendRequest includes Bearer token when present", async () => {
    installBrowserGlobals(mockStorage({ zhin_api_token: "t" }));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager();
    await manager.setConfig("sandbox", { endpoints: [] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("normalizes legacy endpoint push names and payload aliases before callbacks", async () => {
    installBrowserGlobals();
    const received: WebSocketMessage[] = [];
    const manager = new WebSocketManager({}, {
      onMessage: (message) => received.push(message),
    });

    (manager as unknown as { handleMessage(event: MessageEvent): void }).handleMessage({
      data: '{"type":"endpoint:message","data":{"$adapter":"sandbox","endpoint":"bot"}}',
    } as MessageEvent);
    await Promise.resolve();

    expect(received).toEqual([expect.objectContaining({
      type: "message.receive",
      data: expect.objectContaining({ adapter: "sandbox", endpointKey: "bot" }),
    })]);
    expect(mockApplyConsoleEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "message.receive",
    }));
  });

  it("stops reconnecting after maxReconnectAttempts", async () => {
    installBrowserGlobals();
    const fetchMock = mockConsoleTransport(() => sseResponse(500, null));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager({
      reconnectInterval: 10,
      maxReconnectAttempts: 2,
    });
    manager.connect();

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(manager.getState()).toBe(ConnectionState.ERROR);
    const sseCalls = fetchMock.mock.calls.filter(([input]) => !String(input).includes('/history'));
    expect(sseCalls.length).toBeLessThanOrEqual(3);
    manager.disconnect();
  });

  it('recovers typed history before live SSE and preserves event metadata', async () => {
    installBrowserGlobals();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'id: 2',
          'event: message.receive',
          'runtime: runtime-a',
          'timestamp: 200',
          'data: {"adapter":"sandbox","endpointKey":"bot","content":"live"}',
          '',
          '',
        ].join('\n')));
      },
    });
    const historyEvent = {
      runtimeId: 'runtime-a', eventId: 1, type: 'message.receive', timestamp: 100,
      data: { adapter: 'sandbox', endpointKey: 'bot', content: 'history' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('/history')
        ? eventHistoryResponse([historyEvent], 'runtime-a')
        : sseResponse(200, stream)
    ));
    vi.stubGlobal('fetch', fetchMock);
    const received: Array<{ eventId: number; delivery?: string }> = [];
    const manager = new WebSocketManager();
    manager.onConsoleEvent('message.receive', (event) => received.push({ eventId: event.eventId, delivery: event.delivery }));
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([
      { eventId: 1, delivery: 'history' },
      { eventId: 2, delivery: 'live' },
    ]);
    expect(mockApplyConsoleEvent).toHaveBeenCalledTimes(2);
    manager.disconnect();
  });

  it('keeps an in-memory cursor when localStorage is unavailable', async () => {
    const storage = mockStorage();
    storage.setItem = () => { throw new Error('storage disabled'); };
    installBrowserGlobals(storage);
    const historyEvent = {
      runtimeId: 'runtime-a', eventId: 1, type: 'message.receive', timestamp: 100,
      data: { adapter: 'sandbox', endpointKey: 'bot', content: 'history' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const after = new URL(String(input)).searchParams.get('after');
      return after === '1'
        ? eventHistoryResponse([], 'runtime-a', 1)
        : eventHistoryResponse([historyEvent], 'runtime-a', 1);
    });
    vi.stubGlobal('fetch', fetchMock);
    const received: number[] = [];
    const manager = new WebSocketManager();
    manager.onConsoleEvent('message.receive', (event) => received.push(event.eventId));
    const recover = manager as unknown as { recoverEventHistory(signal: AbortSignal): Promise<void> };
    await recover.recoverEventHistory(new AbortController().signal);
    await recover.recoverEventHistory(new AbortController().signal);

    expect(received).toEqual([1]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('after=1');
  });

  it('exposes a typed recovery gap instead of silently treating it as complete', async () => {
    installBrowserGlobals();
    const response = eventHistoryResponse([], 'runtime-new', 9);
    const originalJson = response.json;
    response.json = async () => {
      const body = await originalJson() as { data: Record<string, unknown> };
      return { ...body, data: { ...body.data, gap: true, oldestAvailableEventId: 8 } };
    };
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const manager = new WebSocketManager();
    const gaps: unknown[] = [];
    manager.onConsoleEventRecoveryGap((gap) => gaps.push(gap));
    const recover = manager as unknown as { recoverEventHistory(signal: AbortSignal): Promise<void> };
    await recover.recoverEventHistory(new AbortController().signal);

    expect(gaps).toEqual([expect.objectContaining({
      page: expect.objectContaining({ runtimeId: 'runtime-new', gap: true }),
    })]);
  });

  it('does not persist a cursor past an inbox event that failed durable storage', async () => {
    const stored: Record<string, string> = {};
    installBrowserGlobals(mockStorage(stored));
    mockApplyConsoleEvent.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const historyEvent = {
      runtimeId: 'runtime-a', eventId: 1, type: 'message.receive', timestamp: 100,
      data: { adapter: 'sandbox', endpointKey: 'bot', content: 'history' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => eventHistoryResponse([historyEvent], 'runtime-a', 1)));
    const manager = new WebSocketManager();
    const recover = manager as unknown as { recoverEventHistory(signal: AbortSignal): Promise<void> };
    await recover.recoverEventHistory(new AbortController().signal);

    expect(Object.keys(stored).filter((key) => key.includes('event-cursor'))).toEqual([]);
  });
});
