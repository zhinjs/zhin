import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  GOOGLE_AUTH_SCOPES,
  MICROSOFT_AUTH_SCOPES,
} from "../src/oauth-auth.js";
import { OAuthTokenError, OAuthTokenManager } from "../src/token-manager.js";
import { microsoftCalendarBase } from "../src/oauth.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("oauth-auth PKCE / authorize URL", () => {
  it("builds google URL with offline consent and S256", () => {
    const pkce = createPkcePair(() => Buffer.alloc(32, 7));
    const state = createOAuthState(() => Buffer.alloc(16, 9));
    const url = new URL(
      buildAuthorizeUrl({
        provider: "google",
        clientId: "cid",
        redirectUri: "http://127.0.0.1:53682/callback",
        state,
        codeChallenge: pkce.challenge,
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("state")).toBe(state);
    for (const scope of GOOGLE_AUTH_SCOPES) {
      expect(url.searchParams.get("scope") ?? "").toContain(scope);
    }
  });

  it("builds microsoft URL with offline_access scopes", () => {
    const pkce = createPkcePair(() => Buffer.alloc(32, 3));
    const url = new URL(
      buildAuthorizeUrl({
        provider: "microsoft",
        clientId: "cid",
        redirectUri: "http://127.0.0.1:53682/callback",
        state: "st",
        codeChallenge: pkce.challenge,
        tenant: "common",
      })
    );
    expect(
      url.href.startsWith(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
      )
    ).toBe(true);
    const scope = url.searchParams.get("scope") ?? "";
    for (const item of MICROSOFT_AUTH_SCOPES) expect(scope).toContain(item);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("OAuthTokenManager", () => {
  it("caches access token and refreshes near expiry", async () => {
    let now = 1_000_000;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => {
      calls.push("refresh");
      return jsonResponse({
        access_token: `tok-${calls.length}`,
        expires_in: 3600,
      });
    });
    const manager = new OAuthTokenManager({
      provider: "google",
      clientId: "cid",
      clientSecret: "sec",
      initialRefreshToken: "rt",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    await expect(manager.getAccessToken()).resolves.toBe("tok-1");
    await expect(manager.getAccessToken()).resolves.toBe("tok-1");
    expect(calls).toHaveLength(1);
    // advance to within 5 min of expiry (3600s)
    now = 1_000_000 + (3600 - 4 * 60) * 1000;
    await expect(manager.getAccessToken()).resolves.toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("single-flights concurrent refresh", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const manager = new OAuthTokenManager({
      provider: "microsoft",
      clientId: "cid",
      initialRefreshToken: "rt",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    const p1 = manager.getAccessToken();
    const p2 = manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch!(jsonResponse({ access_token: "shared", expires_in: 3600 }));
    await expect(Promise.all([p1, p2])).resolves.toEqual(["shared", "shared"]);
  });

  it("warns on refresh_token rotation and persists token_file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cal-token-"));
    const tokenFile = path.join(dir, "ms.json");
    const warnings: string[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "a1",
        refresh_token: "rt-new",
        expires_in: 3600,
      })
    );
    const manager = new OAuthTokenManager({
      provider: "microsoft",
      clientId: "cid",
      initialRefreshToken: "rt-old",
      tokenFile,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
      logger: { warn: (message) => warnings.push(message) },
    });
    await manager.getAccessToken();
    expect(manager.refreshToken).toBe("rt-new");
    expect(warnings.some((line) => line.includes("token_file"))).toBe(true);
    const saved = JSON.parse(await readFile(tokenFile, "utf8")) as {
      refresh_token: string;
    };
    expect(saved.refresh_token).toBe("rt-new");
  });

  it("warns to update env when refresh rotates without token_file", async () => {
    const warnings: string[] = [];
    const manager = new OAuthTokenManager({
      provider: "microsoft",
      clientId: "cid",
      initialRefreshToken: "rt-old",
      fetchImpl: (async () =>
        jsonResponse({
          access_token: "a1",
          refresh_token: "rt-rotated",
          expires_in: 3600,
        })) as unknown as typeof fetch,
      now: () => 0,
      logger: { warn: (message) => warnings.push(message) },
    });
    await manager.getAccessToken();
    expect(
      warnings.some(
        (line) => line.includes("rt-rotated") && line.includes("环境变量")
      )
    ).toBe(true);
  });

  it("throws clear invalid_grant errors", async () => {
    const manager = new OAuthTokenManager({
      provider: "google",
      clientId: "cid",
      clientSecret: "sec",
      initialRefreshToken: "dead",
      fetchImpl: (async () =>
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          400
        )) as unknown as typeof fetch,
      now: () => 0,
    });
    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: "OAuthTokenError",
      code: "invalid_grant",
    } satisfies Partial<OAuthTokenError>);
    await expect(manager.getAccessToken()).rejects.toThrow(/日历授权入口/);
  });
});

describe("microsoftCalendarBase", () => {
  it("selects default vs specific calendar id", () => {
    expect(microsoftCalendarBase("")).toBe(
      "https://graph.microsoft.com/v1.0/me/calendar"
    );
    expect(microsoftCalendarBase("primary")).toBe(
      "https://graph.microsoft.com/v1.0/me/calendar"
    );
    expect(microsoftCalendarBase("ABC/123")).toBe(
      "https://graph.microsoft.com/v1.0/me/calendars/ABC%2F123"
    );
  });
});
