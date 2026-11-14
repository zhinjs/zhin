import { afterEach, describe, expect, it, vi } from "vitest";
import { maskConsoleEnvValue, type ConsoleEnvFileView } from "@zhin.js/console-protocol";

// useEnvFiles is driven as a plain function: just enough of React for one render, no effects.
vi.mock("react", () => ({
  useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined],
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
}));

const transport = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../console-client-context.js", () => ({
  useConsoleClient: () => ({ transport: transport.current }),
}));

import { ConsoleTransport } from "./console-transport.js";
import { useEnvFiles } from "./hooks.js";

const maskedView: ConsoleEnvFileView = {
  format: "masked",
  file: ".env",
  variables: [{ key: "API_KEY", masked: maskConsoleEnvValue("sk-1234567890"), hasValue: true }],
  lines: [{ kind: "entry", key: "API_KEY" }],
  content: `API_KEY=${maskConsoleEnvValue("sk-1234567890")}\n`,
};

/** A real ConsoleTransport whose Host answers `env:*` from `reply`; returns the request bodies it got. */
function hostWith(reply: (body: Record<string, unknown>) => unknown) {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal("location", { pathname: "/", origin: "https://host.test" });
  vi.stubGlobal("window", { location: { pathname: "/", origin: "https://host.test" }, dispatchEvent: vi.fn() });
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);
    return { ok: true, status: 200, json: async () => ({ success: true, data: reply(body) }) } as Response;
  });
  const manager = new ConsoleTransport({ fetch: fetchMock as never });
  transport.current = manager;
  return { manager, bodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
  transport.current = undefined;
});

describe("useEnvFiles with a masking Host (#1250)", () => {
  it("getFile keeps returning text (the masked content) and getView returns the masked view", async () => {
    hostWith(() => maskedView);
    const env = useEnvFiles();
    await expect(env.getFile(".env")).resolves.toBe(maskedView.content);
    await expect(env.getView(".env")).resolves.toEqual(maskedView);
  });

  it("getView is null for an older Host that answers env:get with the file as written", async () => {
    hostWith(() => ({ content: "API_KEY=sk-1234567890\n" }));
    const env = useEnvFiles();
    await expect(env.getView(".env")).resolves.toBeNull();
    await expect(env.getFile(".env")).resolves.toBe("API_KEY=sk-1234567890\n");
  });

  it("reveal asks env:reveal for one key and returns its value", async () => {
    const { bodies } = hostWith(body => ({ file: body.filename, key: body.key, value: "sk-1234567890" }));
    const env = useEnvFiles();
    await expect(env.reveal(".env", "API_KEY")).resolves.toBe("sk-1234567890");
    expect(bodies[0]).toMatchObject({ type: "env:reveal", filename: ".env", key: "API_KEY" });
  });

  it("saveChanges sends only the submitted keys", async () => {
    const { bodies } = hostWith(() => ({ success: true, message: "ok", changed: ["API_KEY", "OLD"] }));
    const env = useEnvFiles();
    const result = await env.saveChanges(".env", [{ key: "API_KEY", value: "sk-new-value" }, { key: "OLD", delete: true }]);
    expect(result.changed).toEqual(["API_KEY", "OLD"]);
    expect(bodies[0]).toEqual({
      type: "env:save",
      filename: ".env",
      changes: [{ key: "API_KEY", value: "sk-new-value" }, { key: "OLD", delete: true }],
      requestId: expect.any(Number),
    });
    expect(bodies[0]).not.toHaveProperty("content");
  });

  it("saveChanges refuses a mask placeholder before anything is sent", async () => {
    const { bodies } = hostWith(() => ({ success: true, message: "ok" }));
    const env = useEnvFiles();
    await expect(env.saveChanges(".env", [{ key: "API_KEY", value: maskedView.variables[0]!.masked }]))
      .rejects.toThrow(/API_KEY/);
    expect(bodies).toHaveLength(0);
  });

  it("saveFile stays available as an explicit whole-file replace", async () => {
    const { bodies } = hostWith(() => ({ success: true, message: "ok" }));
    const env = useEnvFiles();
    await env.saveFile(".env", "API_KEY=sk-new-value\n");
    expect(bodies[0]).toMatchObject({ type: "env:save", filename: ".env", content: "API_KEY=sk-new-value\n", mode: "replace" });
  });
});
