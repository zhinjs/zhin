import { describe, expect, it, vi } from "vitest";
import {
  buildRedirectUri,
  CalendarAuthService,
  localOriginFromAddress,
  parseOAuthProvider,
} from "../src/chat-auth.js";
import {
  CalendarCredentialStore,
  type CalendarStateStore,
} from "../src/credential-store.js";
import { OAuthSessionRegistry } from "../src/oauth-session.js";
import { OAuthTokenManager } from "../src/token-manager.js";
import type { CalendarConfig } from "../src/config.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMemoryState(): CalendarStateStore & {
  readonly values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async set(key: string, value: never) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}

const googleConfig = {
  provider: "google",
  timezone: "Asia/Manila",
  work_day_start: "09:00",
  work_day_end: "18:00",
  oauth_redirect_base_url: "",
  oauth_callback_path: "/calendar/oauth/callback",
  google: {
    enabled: true,
    client_id: "cid",
    client_secret: "secret",
    refresh_token: "",
    calendar_id: "primary",
    token_file: "",
  },
  microsoft: {
    enabled: false,
    client_id: "",
    client_secret: "",
    refresh_token: "",
    tenant: "common",
    calendar_id: "",
    token_file: "",
  },
  caldav: { enabled: false, calendar_url: "", username: "", password: "" },
} as unknown as CalendarConfig;

const requester = {
  sender_id: "master-1",
  target: {
    endpoint: { adapter: "icqq", id: "bot" },
    kind: "private",
    id: "1",
  },
};

function createService(fetchImpl: typeof fetch) {
  const state = createMemoryState();
  const credentials = new CalendarCredentialStore(state);
  const manager = new OAuthTokenManager({
    provider: "google",
    clientId: "cid",
    clientSecret: "secret",
    tokenStore: credentials.refreshTokenStore("google"),
    fetchImpl,
    now: () => 0,
  });
  const notifications: string[] = [];
  const notificationLocales: string[] = [];
  const service = new CalendarAuthService({
    config: googleConfig,
    managers: { google: manager },
    credentials,
    notify: async (_target, text, locale) => {
      notifications.push(text);
      notificationLocales.push(locale);
    },
    resolveRedirectUri: () => "http://127.0.0.1:8068/calendar/oauth/callback",
    fetchImpl,
  });
  return { state, credentials, manager, notifications, notificationLocales, service };
}

function extractState(reply: string): string {
  const link = reply.split("\n").find((line) => line.startsWith("https://"));
  return new URL(link ?? "").searchParams.get("state") ?? "";
}

describe("chat authorization", () => {
  it("pins authorization language through callbacks and later loss notifications", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })) as unknown as typeof fetch;
    const { credentials, notifications, notificationLocales, service } = createService(fetchImpl);
    const person = { ...requester, locale: 'en' as 'en' | 'zh-CN' };
    const reply = await service.startAuthorization('google', person, 'en');
    expect(reply).toContain('Open the link');
    person.locale = 'zh-CN';
    const result = await service.handleCallback(new URLSearchParams({ state: extractState(reply), code: 'synthetic-code' }));
    expect(result.message).toContain('Authorization succeeded');
    expect(notifications.at(-1)).toContain('Google Calendar authorization succeeded');
    expect((await credentials.get('google'))?.authorized_by?.locale).toBe('en');
    await service.notifyAuthorizationLost('google', 'provider detail');
    expect(notifications.at(-1)).toContain('authorization expired or was revoked');
    expect(notificationLocales).toEqual(['en', 'en']);
  });

  it("uses an explicitly resolved command head in status and never invents a prefix", async () => {
    const { service } = createService(vi.fn() as unknown as typeof fetch);
    expect(await service.describeStatus('en', '!work calendar auth')).toContain('!work calendar auth google');
    const withoutHead = await service.describeStatus('en');
    expect(withoutHead).toContain('not authorized');
    expect(withoutHead).not.toContain('calendar auth google');
  });

  it("parses provider aliases", () => {
    expect(parseOAuthProvider("Google")).toBe("google");
    expect(parseOAuthProvider("outlook")).toBe("microsoft");
    expect(parseOAuthProvider("icloud")).toBeUndefined();
  });

  it("builds redirect URIs from bases and listening addresses", () => {
    expect(buildRedirectUri("https://bot.example.com/", "grokbot/cb")).toBe(
      "https://bot.example.com/grokbot/cb"
    );
    expect(
      localOriginFromAddress({ protocol: "http", host: "0.0.0.0", port: 8068 })
    ).toBe("http://127.0.0.1:8068");
  });

  it("stores the refresh token and notifies the requester on callback", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt-new",
        expires_in: 3600,
      })
    ) as unknown as typeof fetch;
    const { credentials, manager, notifications, service } =
      createService(fetchImpl);

    const reply = await service.startAuthorization("google", requester);
    expect(reply).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A8068");
    const state = extractState(reply);

    const result = await service.handleCallback(
      new URLSearchParams({ state, code: "auth-code" })
    );
    expect(result.statusCode).toBe(200);
    expect((await credentials.get("google"))?.refresh_token).toBe("rt-new");
    expect(manager.hasRefreshToken).toBe(true);
    expect(notifications.at(-1)).toContain("授权成功");

    const replay = await service.handleCallback(
      new URLSearchParams({ state, code: "auth-code" })
    );
    expect(replay.statusCode).toBe(400);
  });

  it("asks the master to re-authorize after invalid_grant and notifies once", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "revoked" },
        400
      )
    ) as unknown as typeof fetch;
    const state = createMemoryState();
    const credentials = new CalendarCredentialStore(state);
    await credentials.save("google", "rt-dead", requester);
    const lost = vi.fn();
    const manager = new OAuthTokenManager({
      provider: "google",
      clientId: "cid",
      clientSecret: "secret",
      tokenStore: credentials.refreshTokenStore("google"),
      onAuthorizationLost: lost,
      fetchImpl,
      now: () => 0,
    });
    await manager.hydrate();

    await expect(manager.getAccessToken()).rejects.toThrow(
      /日历授权入口/
    );
    await expect(manager.getAccessToken()).rejects.toThrow(
      /日历授权入口/
    );
    expect(lost).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports not_authorized when no token is stored or configured", async () => {
    const manager = new OAuthTokenManager({
      provider: "google",
      clientId: "cid",
      clientSecret: "secret",
    });
    await expect(manager.getAccessToken()).rejects.toMatchObject({
      code: "not_authorized",
    });
  });

  it("prefers the stored token over the env fallback", async () => {
    const state = createMemoryState();
    const credentials = new CalendarCredentialStore(state);
    await credentials.save("google", "rt-stored", null);
    const manager = new OAuthTokenManager({
      provider: "google",
      clientId: "cid",
      clientSecret: "secret",
      initialRefreshToken: "rt-env",
      tokenStore: credentials.refreshTokenStore("google"),
    });
    await manager.hydrate();
    expect(manager.refreshToken).toBe("rt-stored");
  });
});

describe("OAuthSessionRegistry", () => {
  it("expires sessions after the TTL", () => {
    let now = 0;
    const registry = new OAuthSessionRegistry<string>({
      now: () => now,
      ttlMs: 1000,
    });
    registry.create({
      provider: "google",
      state: "s1",
      codeVerifier: "v",
      redirectUri: "http://x/cb",
      requester: "r",
    });
    now = 1001;
    expect(registry.consume("s1")).toBeUndefined();
  });
});


it('forwards the captured authorization language through the plugin outbound facade', async () => {
  const { default: plugin } = await import('../plugin.js');
  const { databaseHostToken, outboundHostToken } = await import('zhin.js');
  const { projectLocaleToken } = await import('zhin.js/i18n');
  const { calendarRuntimeToken } = await import('../src/runtime.js');
  const sendTarget = vi.fn();
  const values = new Map<string, unknown>([
    [databaseHostToken.id, { state: createMemoryState() }],
    [outboundHostToken.id, { sendTarget }],
    [projectLocaleToken.id, 'zh-CN'],
  ]);
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 })));
  try {
    await plugin.setup?.({ config: { get: () => ({ ...googleConfig, oauth_redirect_base_url: 'http://localhost' }) }, resources: {
      has: (token: { id: string }) => values.has(token.id),
      use: (token: { id: string }) => values.get(token.id),
      provide: (token: { id: string }, value: unknown) => values.set(token.id, value),
    } } as never);
    const { auth } = values.get(calendarRuntimeToken.id) as { auth: CalendarAuthService<unknown> };
    const reply = await auth.startAuthorization('google', { ...requester, locale: 'en' }, 'en');
    await auth.handleCallback(new URLSearchParams({ state: extractState(reply), code: 'fixture-code' }));
    expect(sendTarget).toHaveBeenCalledExactlyOnceWith(requester.target, expect.stringContaining('authorization succeeded'), { locale: 'en' });
  } finally { vi.unstubAllGlobals(); }
});


it('localizes owned OAuth exchange errors in both callback and notification without translating provider detail', async () => {
  const { service, notifications, notificationLocales } = createService(async () => jsonResponse({ error: 'denied', error_description: '原始服务原因' }, 400));
  const reply = await service.startAuthorization('google', { ...requester, locale: 'en' }, 'en');
  const result = await service.handleCallback(new URLSearchParams({ state: extractState(reply), code: 'fixture-code' }));
  expect(result.statusCode).toBe(502);
  expect(result.message).toBe('Authorization failed: google: token exchange failed: 原始服务原因');
  expect(notifications).toEqual(['Google Calendar authorization failed: google: token exchange failed: 原始服务原因']);
  expect(notificationLocales).toEqual(['en']);
});
