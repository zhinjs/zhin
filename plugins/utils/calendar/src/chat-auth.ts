import { CalendarError } from './errors.js';
import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
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
  text: string,
  locale: Locale
) => Promise<void>;

export interface CalendarAuthServiceOptions<Target> {
  readonly config: CalendarConfig;
  readonly locale?: Locale;
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
  readonly #locale: Locale;
  readonly #managers: Partial<Record<OAuthProviderKind, OAuthTokenManager>>;
  readonly #credentials: CalendarCredentialStore | undefined;
  readonly #notify: CalendarNotifier<Target> | undefined;
  readonly #resolveRedirectUri: () => string | undefined;
  readonly #fetch: typeof fetch | undefined;
  readonly #sessions: OAuthSessionRegistry<CredentialOwner<Target>>;

  constructor(options: CalendarAuthServiceOptions<Target>) {
    this.#config = options.config;
    this.#locale = resolveLocale(options.locale);
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
    requester: CredentialOwner<Target>,
    locale: Locale = resolveLocale(requester.locale)
  ): Promise<string> {
    const displayName = t(locale, provider);
    if (!this.#credentials) {
      return t(locale, 'needsDatabase');
    }
    const client = this.#clientCredentials(provider);
    if (!client) {
      return this.#missingClientMessage(provider, locale);
    }
    const redirectUri = this.#resolveRedirectUri();
    if (!redirectUri) {
      return t(locale, 'needsHttp');
    }

    const pkce = createPkcePair();
    const state = createOAuthState();
    this.#sessions.create({
      provider,
      state,
      codeVerifier: pkce.verifier,
      redirectUri,
      requester: { ...requester, locale },
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
      t(locale, 'openLink', { provider: displayName, minutes: validMinutes }),
      authorizeUrl,
      "",
      t(locale, 'callback', { url: redirectUri }),
      t(locale, 'callbackHelp'),
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
          t(this.#locale, 'invalidLink'),
      };
    }

    const locale = resolveLocale(session.requester.locale);
    const provider = session.provider;
    const displayName = t(locale, provider);
    const oauthError = searchParams.get("error");
    if (oauthError) {
      const description = searchParams.get("error_description") ?? "";
      const detail = `${oauthError} ${description}`.trim();
      await this.#notifySafely(
        session.requester.target,
        t(locale, 'failed', { provider: displayName, detail }),
        locale
      );
      return { statusCode: 400, message: t(locale, 'callbackFailed', { detail }) };
    }

    const code = searchParams.get("code") ?? "";
    const client = this.#clientCredentials(provider);
    if (!code || !client || !this.#credentials) {
      return {
        statusCode: 400,
        message: t(locale, 'codeMissing'),
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
      const reason = error instanceof CalendarError ? error.format(locale) : error instanceof Error ? error.message : String(error);
      await this.#notifySafely(
        session.requester.target,
        t(locale, 'failed', { provider: displayName, detail: reason }),
        locale
      );
      return { statusCode: 502, message: t(locale, 'callbackFailed', { detail: reason }) };
    }

    const providerHint =
      this.#config.provider === provider
        ? ""
        : t(locale, 'otherProvider', { current: this.#config.provider, provider });
    await this.#notifySafely(
      session.requester.target,
      t(locale, 'authorized', { provider: displayName, hint: providerHint }),
      locale
    );
    return { statusCode: 200, message: t(locale, 'callbackSuccess') };
  }

  /** Handles `calendar status`. */
  async describeStatus(locale?: Locale, authCommand?: string): Promise<string> {
    const lines = [t(locale, 'currentProvider', { provider: this.#config.provider })];
    for (const provider of OAUTH_PROVIDERS) {
      lines.push(await this.#describeProvider(provider, locale, authCommand));
    }
    return lines.join("\n");
  }

  /** Handles `calendar logout <provider>`: removes the stored token. */
  async logout(provider: OAuthProviderKind, locale?: Locale): Promise<string> {
    const displayName = t(locale, provider);
    if (!this.#credentials) {
      return t(locale, 'noDatabase');
    }
    await this.#credentials.delete(provider);
    this.#managers[provider]?.clearTokens();
    return t(locale, 'loggedOut', { provider: displayName });
  }

  /** Called by the token manager once when the refresh token is rejected. */
  async notifyAuthorizationLost(
    provider: OAuthProviderKind,
    _message: string
  ): Promise<void> {
    const credential = await this.#credentials?.get(provider);
    const owner = credential?.authorized_by as CredentialOwner<Target> | null;
    if (!owner) {
      return;
    }
    const locale = resolveLocale(owner.locale);
    await this.#notifySafely(owner.target, t(locale, 'lost', { provider: t(locale, provider) }), locale);
  }

  async #describeProvider(provider: OAuthProviderKind, locale?: Locale, authCommand?: string): Promise<string> {
    const displayName = t(locale, provider);
    if (!this.#clientCredentials(provider)) {
      return t(locale, 'clientMissing', { provider: displayName });
    }
    const credential = await this.#credentials?.get(provider);
    const manager = this.#managers[provider];
    if (manager?.authorizationLost) {
      return [t(locale, 'lost', { provider: displayName }), authCommand ? t(locale, 'commandHint', { command: authCommandFor(provider, authCommand)! }) : ''].filter(Boolean).join(' ');
    }
    if (credential) {
      return t(locale, 'databaseStatus', { provider: displayName, at: credential.authorized_at });
    }
    if (manager?.hasRefreshToken) {
      return t(locale, 'envStatus', { provider: displayName });
    }
    return [t(locale, 'notAuthorized', { provider: displayName }), authCommand ? t(locale, 'commandHint', { command: authCommandFor(provider, authCommand)! }) : ''].filter(Boolean).join(' ');
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

  #missingClientMessage(provider: OAuthProviderKind, locale?: Locale): string {
    if (provider === "google") {
      return t(locale, 'googleClient');
    }
    return t(locale, 'microsoftClient');
  }

  async #notifySafely(target: Target, text: string, locale: Locale): Promise<void> {
    if (!this.#notify) {
      return;
    }
    try {
      await this.#notify(target, text, locale);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[calendar] 发送授权通知失败：${reason}`);
    }
  }
}
