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

import {
  getUpdates,
  IlinkClientMetadata,
  sendMessage,
  sanitizeBotAgent,
} from "../src/ilink-api.js";

const metadata = new IlinkClientMetadata({ version: "1.2.3" });

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
      metadata,
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
      metadata,
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
      metadata,
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

  it("keeps endpoint metadata isolated", () => {
    const left = new IlinkClientMetadata({ version: "1.2.3", botAgent: "Left/1.0" });
    const right = new IlinkClientMetadata({ version: "4.5.6", botAgent: "Right/2.0" });

    expect(left.buildBaseInfo()).toEqual({
      channel_version: "1.2.3",
      bot_agent: "Left/1.0",
    });
    expect(right.buildBaseInfo()).toEqual({
      channel_version: "4.5.6",
      bot_agent: "Right/2.0",
    });
    expect(left.appClientVersion).toBe(0x010203);
    expect(right.appClientVersion).toBe(0x040506);
  });

  it("uses the metadata supplied by each request", async () => {
    const left = new IlinkClientMetadata({ version: "1.2.3", botAgent: "Left/1.0" });
    const right = new IlinkClientMetadata({ version: "4.5.6", botAgent: "Right/2.0" });
    mockFetch.mockResolvedValue(mockResponse("{}"));

    await sendMessage({
      baseUrl: "https://api.example.com",
      metadata: left,
      body: { msg: { to_user_id: "left" } },
    });
    await sendMessage({
      baseUrl: "https://api.example.com",
      metadata: right,
      body: { msg: { to_user_id: "right" } },
    });

    const leftRequest = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const rightRequest = mockFetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(leftRequest.body)).base_info).toEqual(left.buildBaseInfo());
    expect(JSON.parse(String(rightRequest.body)).base_info).toEqual(right.buildBaseInfo());
    expect((leftRequest.headers as Record<string, string>)["iLink-App-ClientVersion"])
      .toBe(String(left.appClientVersion));
    expect((rightRequest.headers as Record<string, string>)["iLink-App-ClientVersion"])
      .toBe(String(right.appClientVersion));
  });
});
