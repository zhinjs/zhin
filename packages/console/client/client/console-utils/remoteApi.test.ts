import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, getToken } from "./remoteApi.js";

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

function installBrowserGlobals(runtimeToken?: string) {
  const win = {
    location: { origin: "http://localhost:5173", protocol: "http:", host: "localhost:5173" },
    __ZHIN_API_TOKEN: runtimeToken as string | undefined,
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", mockStorage());
  vi.stubGlobal("sessionStorage", mockStorage());
  return win;
}

function fakeResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe("apiFetch 401 handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("invalidates an expired runtime token on 401 so it cannot 401-loop forever", async () => {
    // 回归：runtime token（Demo 预置）优先级最高，而旧实现 401 只清 local/sessionStorage，
    // 过期 demo token 会让后续每个请求都 401。
    const win = installBrowserGlobals("expired-demo-token");
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(401)));

    expect(getToken()).toBe("expired-demo-token");
    await apiFetch("/api/system/status");

    expect(win.__ZHIN_API_TOKEN).toBeUndefined();
    expect(getToken()).toBeNull();
    expect(win.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the runtime token when the response is not 401", async () => {
    const win = installBrowserGlobals("valid-demo-token");
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200)));

    await apiFetch("/api/system/status");

    expect(win.__ZHIN_API_TOKEN).toBe("valid-demo-token");
    expect(getToken()).toBe("valid-demo-token");
    expect(win.dispatchEvent).not.toHaveBeenCalled();
  });
});
