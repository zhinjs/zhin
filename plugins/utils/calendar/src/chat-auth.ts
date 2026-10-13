/**
 * Chat-driven OAuth authorization: `calendar auth <provider>` creates a PKCE
 * link, the HTTP callback exchanges the code, stores the refresh token in the
 * plugin database and notifies the conversation that requested it.
 */
import type { CalendarConfig } from "./config.js";
import type {
  CalendarCredentialStore,
  CredentialOwner,
} from "./credential-store.js";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
} from "./oauth-auth.js";
import { OAuthSessionRegistry, OAUTH_SESSION_TTL_MS } from "./oauth-session.js";
import { cleanSecret } from "./secrets.js";
import {
  authCommandFor,
  type OAuthProviderKind,
  type OAuthTokenManager,
} from "./token-manager.js";

export const DEFAULT_OAUTH_CALLBACK_PATH = "/calendar/oauth/callback";

export const OAUTH_PROVIDERS: readonly OAuthProviderKind[] = [
  "google",
  "microsoft",
];

export type CalendarNotifier<Target> = (
  target: Target,
  text: string
) => Promise<void>;

export interface CalendarAuthServiceOptions<Target> {
  readonly config: CalendarConfig;
  readonly managers: Partial<Record<OAuthProviderKind, OAuthTokenManager>>;
  readonly credentials: CalendarCredentialStore | undefined;
  readonly notify: CalendarNotifier<Target> | undefined;
  /** Returns the full callback URL, or undefined when no HTTP host is available. */
  readonly resolveRedirectUri: () => string | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface CallbackResult {
  readonly statusCode: number;
  readonly message: string;
}

interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenant: string;
}

const PROVIDER_DISPLAY_NAME: Record<OAuthProviderKind, string> = {
  google: "Google 日历",
  microsoft: "Outlook 日历",
};

export function parseOAuthProvider(
  value: unknown
): OAuthProviderKind | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "google") {
    return "google";
  }
  if (normalized === "microsoft" || normalized === "outlook") {
    return "microsoft";
  }
  return undefined;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

function trimLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value[start] === "/") {
    start += 1;
  }
  return value.slice(start);
}

/** Joins a base URL and the callback path, tolerating extra/missing slashes. */
export function buildRedirectUri(
  baseUrl: string,
  callbackPath: string
): string {
  const trimmedBase = trimTrailingSlashes(baseUrl.trim());
  const normalizedPath = `/${trimLeadingSlashes(callbackPath.trim())}`;
  return `${trimmedBase}${normalizedPath}`;
}

/** Turns a listening address into a browser-reachable local origin. */
export function localOriginFromAddress(address: {
  readonly protocol: string;
  readonly host: string;
  readonly port: number;
}): string {
  const wildcardHosts = new Set(["0.0.0.0", "::", "[::]", ""]);
  const host = wildcardHosts.has(address.host) ? "127.0.0.1" : address.host;
  const formattedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${address.protocol}://${formattedHost}:${address.port}`;
}

export class CalendarAuthService<Target> {
  readonly #config: CalendarConfig;
  readonly #managers: Partial<Record<OAuthProviderKind, OAuthTokenManager>>;
  readonly #credentials: CalendarCredentialStore | undefined;
  readonly #notify: CalendarNotifier<Target> | undefined;
  readonly #resolveRedirectUri: () => string | undefined;
  readonly #fetch: typeof fetch | undefined;
  readonly #sessions: OAuthSessionRegistry<CredentialOwner<Target>>;

  constructor(options: CalendarAuthServiceOptions<Target>) {
    this.#config = options.config;
    this.#managers = options.managers;
    this.#credentials = options.credentials;
    this.#notify = options.notify;
    this.#resolveRedirectUri = options.resolveRedirectUri;
    this.#fetch = options.fetchImpl;
    this.#sessions = new OAuthSessionRegistry({ now: options.now });
  }

  /** Handles `calendar auth <provider>` and returns the chat reply. */
  async startAuthorization(
    provider: OAuthProviderKind,
    requester: CredentialOwner<Target>
  ): Promise<string> {
    const displayName = PROVIDER_DISPLAY_NAME[provider];
    if (!this.#credentials) {
      return "日历授权需要数据库（databaseHostToken）来保存 refresh_token，当前不可用。";
    }
    const client = this.#clientCredentials(provider);
    if (!client) {
      return this.#missingClientMessage(provider);
    }
    const redirectUri = this.#resolveRedirectUri();
    if (!redirectUri) {
      return "未找到 HTTP 服务地址：请启用 zhin 的 HTTP Host，或在 plugins.calendar.oauth_redirect_base_url 配置外部可访问地址。";
    }

    const pkce = createPkcePair();
    const state = createOAuthState();
    this.#sessions.create({
      provider,
      state,
      codeVerifier: pkce.verifier,
      redirectUri,
      requester,
    });
    const authorizeUrl = buildAuthorizeUrl({
      provider,
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
      tenant: client.tenant,
    });

    const validMinutes = Math.round(OAUTH_SESSION_TTL_MS / 60_000);
    return [
      `请在浏览器打开下面的链接完成${displayName}授权（${validMinutes} 分钟内有效，只能使用一次）：`,
      authorizeUrl,
      "",
      `回调地址：${redirectUri}`,
      "该地址必须能从打开链接的浏览器访问，并已登记在 OAuth 客户端的重定向 URI 中。",
    ].join("\n");
  }

  /** Handles the OAuth redirect back to the HTTP host. */
  async handleCallback(searchParams: URLSearchParams): Promise<CallbackResult> {
    const state = searchParams.get("state") ?? "";
    const session = state ? this.#sessions.consume(state) : undefined;
    if (!session) {
      return {
        statusCode: 400,
        message:
          "授权链接无效、已使用或已过期，请在聊天中重新发送 calendar auth 命令。",
      };
    }

    const provider = session.provider;
    const displayName = PROVIDER_DISPLAY_NAME[provider];
    const oauthError = searchParams.get("error");
    if (oauthError) {
      const description = searchParams.get("error_description") ?? "";
      const detail = `${oauthError} ${description}`.trim();
      await this.#notifySafely(
        session.requester.target,
        `${displayName}授权失败：${detail}`
      );
      return { statusCode: 400, message: `授权失败：${detail}` };
    }

    const code = searchParams.get("code") ?? "";
    const client = this.#clientCredentials(provider);
    if (!code || !client || !this.#credentials) {
      return {
        statusCode: 400,
        message: "缺少授权码或客户端配置，请重新授权。",
      };
    }

    try {
      const tokens = await exchangeAuthorizationCode({
        provider,
        clientId: client.clientId,
        clientSecret: client.clientSecret || undefined,
        tenant: client.tenant,
        redirectUri: session.redirectUri,
        code,
        codeVerifier: session.codeVerifier,
        fetchImpl: this.#fetch,
      });
      await this.#credentials.save(
        provider,
        tokens.refreshToken,
        session.requester as CredentialOwner
      );
      this.#managers[provider]?.setRefreshToken(tokens.refreshToken);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.#notifySafely(
        session.requester.target,
        `${displayName}授权失败：${reason}`
      );
      return { statusCode: 502, message: `授权失败：${reason}` };
    }

    const providerHint =
      this.#config.provider === provider
        ? ""
        : `\n注意：当前 plugins.calendar.provider 是 ${
            this.#config.provider
          }，日历工具不会使用 ${provider}。`;
    await this.#notifySafely(
      session.requester.target,
      `${displayName}授权成功，refresh_token 已保存到插件数据库。${providerHint}`
    );
    return { statusCode: 200, message: "授权成功，可以关闭此页回到聊天。" };
  }

  /** Handles `calendar status`. */
  async describeStatus(): Promise<string> {
    const lines = [`当前 provider：${this.#config.provider}`];
    for (const provider of OAUTH_PROVIDERS) {
      lines.push(await this.#describeProvider(provider));
    }
    return lines.join("\n");
  }

  /** Handles `calendar logout <provider>`: removes the stored token. */
  async logout(provider: OAuthProviderKind): Promise<string> {
    const displayName = PROVIDER_DISPLAY_NAME[provider];
    if (!this.#credentials) {
      return "数据库不可用，没有可删除的授权。";
    }
    await this.#credentials.delete(provider);
    this.#managers[provider]?.clearTokens();
    return `已删除${displayName}在插件数据库中的授权。若 .env 里仍有 refresh_token，重载配置后会继续作为后备使用。`;
  }

  /** Called by the token manager once when the refresh token is rejected. */
  async notifyAuthorizationLost(
    provider: OAuthProviderKind,
    message: string
  ): Promise<void> {
    const credential = await this.#credentials?.get(provider);
    const owner = credential?.authorized_by as CredentialOwner<Target> | null;
    if (!owner) {
      return;
    }
    await this.#notifySafely(owner.target, message);
  }

  async #describeProvider(provider: OAuthProviderKind): Promise<string> {
    const displayName = PROVIDER_DISPLAY_NAME[provider];
    if (!this.#clientCredentials(provider)) {
      return `${displayName}：未配置 client_id`;
    }
    const credential = await this.#credentials?.get(provider);
    const manager = this.#managers[provider];
    if (manager?.authorizationLost) {
      return `${displayName}：授权已失效，请发送「${authCommandFor(
        provider
      )}」`;
    }
    if (credential) {
      return `${displayName}：已授权（数据库，${credential.authorized_at}）`;
    }
    if (manager?.hasRefreshToken) {
      return `${displayName}：使用配置/环境变量中的 refresh_token`;
    }
    return `${displayName}：未授权，请发送「${authCommandFor(provider)}」`;
  }

  #clientCredentials(
    provider: OAuthProviderKind
  ): ClientCredentials | undefined {
    if (provider === "google") {
      const google = this.#config.google;
      const clientId = cleanSecret(google?.client_id ?? "");
      const clientSecret = cleanSecret(google?.client_secret ?? "");
      if (!clientId || !clientSecret) {
        return undefined;
      }
      return { clientId, clientSecret, tenant: "common" };
    }
    const microsoft = this.#config.microsoft;
    const clientId = cleanSecret(microsoft?.client_id ?? "");
    if (!clientId) {
      return undefined;
    }
    return {
      clientId,
      clientSecret: cleanSecret(microsoft?.client_secret ?? ""),
      tenant: microsoft?.tenant || "common",
    };
  }

  #missingClientMessage(provider: OAuthProviderKind): string {
    if (provider === "google") {
      return "请先在 plugins.calendar.google 配置 client_id 和 client_secret（例如 ${GOOGLE_CALENDAR_CLIENT_ID} / ${GOOGLE_CALENDAR_CLIENT_SECRET}）。";
    }
    return "请先在 plugins.calendar.microsoft 配置 client_id（例如 ${MS_GRAPH_CLIENT_ID}）。";
  }

  async #notifySafely(target: Target, text: string): Promise<void> {
    if (!this.#notify) {
      return;
    }
    try {
      await this.#notify(target, text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[calendar] 发送授权通知失败：${reason}`);
    }
  }
}
