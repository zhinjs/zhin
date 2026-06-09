/**
 * iLink API 单元测试（mock fetch，不发真实请求）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/ilink-logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("node:crypto", () => ({
  default: {
    randomBytes: vi.fn(() => ({
      readUInt32BE: () => 12345,
    })),
  },
}));

import { getUpdates, sendMessage, sanitizeBotAgent } from "../src/ilink-api.js";

function mockResponse(body: object | string, status = 200, ok = true): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: () => Promise.resolve(text),
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUpdates", () => {
  it("returns parsed response on success", async () => {
    const resp = { ret: 0, msgs: [{ seq: 1 }], get_updates_buf: "buf" };
    mockFetch.mockResolvedValueOnce(mockResponse(resp));
    const result = await getUpdates({
      baseUrl: "https://api.example.com",
      get_updates_buf: "old-buf",
      token: "tok",
    });
    expect(result.ret).toBe(0);
    expect(result.msgs).toHaveLength(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("ilink/bot/getupdates");
    expect(opts.method).toBe("POST");
  });

  it("returns empty response on abort timeout", async () => {
    const abortErr = new Error("AbortError");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);
    const result = await getUpdates({
      baseUrl: "https://api.example.com",
      get_updates_buf: "buf",
    });
    expect(result.ret).toBe(0);
    expect(result.msgs).toEqual([]);
  });
});

describe("sendMessage", () => {
  it("posts JSON body", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("{}"));
    await sendMessage({
      baseUrl: "https://api.example.com",
      token: "tok",
      body: { msg: { to_user_id: "u1" } },
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("POST");
    expect(String(opts.body)).toContain("to_user_id");
  });
});

describe("sanitizeBotAgent", () => {
  it("defaults invalid agent to Zhin.js", () => {
    expect(sanitizeBotAgent("")).toBe("Zhin.js");
    expect(sanitizeBotAgent("not valid !!!")).toBe("Zhin.js");
  });

  it("accepts UA-style token", () => {
    expect(sanitizeBotAgent("Zhin.js/1.0.0")).toBe("Zhin.js/1.0.0");
  });
});
