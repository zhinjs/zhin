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
    const fetchMock = vi.fn(async () => sseResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager({ reconnectInterval: 100, maxReconnectAttempts: 3 });
    const states: boolean[] = [];
    manager.onConnectionChange((c) => states.push(c));
    manager.connect();

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers.Authorization).toBeUndefined();
    expect(manager.getState()).toBe(ConnectionState.CONNECTED);
    expect(manager.isConnected()).toBe(true);
    manager.disconnect();
  });

  it("sends Authorization when a token is stored", async () => {
    installBrowserGlobals(mockStorage({ zhin_api_token: "secret" }));
    const fetchMock = vi.fn(async () => sseResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new WebSocketManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    manager.disconnect();
  });

  it("reconnects after a transient SSE failure (no ERROR deadlock)", async () => {
    installBrowserGlobals();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return sseResponse(503, null);
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
    expect(calls).toBe(1);

    // scheduleReconnect delay = 100 * attempt(1) = 100ms
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBeGreaterThanOrEqual(2);
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
      data: expect.objectContaining({ adapter: "sandbox", endpointId: "bot" }),
    })]);
    expect(mockApplyConsoleEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "message.receive",
    }));
  });

  it("stops reconnecting after maxReconnectAttempts", async () => {
    installBrowserGlobals();
    const fetchMock = vi.fn(async () => sseResponse(500, null));
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
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    manager.disconnect();
  });
});
