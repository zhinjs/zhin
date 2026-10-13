import type { CalendarConfig } from "./config.js";
import { cleanSecret } from "./secrets.js";
import { createCalDavProvider } from "./caldav.js";
import {
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from "./oauth.js";
import type { CalendarProvider } from "./types.js";
import type { CalendarCredentialStore } from "./credential-store.js";
import {
  OAuthTokenManager,
  type AuthorizationLostListener,
  type OAuthProviderKind,
} from "./token-manager.js";

export type {
  CalendarEvent,
  CreateEventInput,
  FreeSlot,
  CalendarProvider,
} from "./types.js";
export { findFreeSlots } from "./free-time.js";
export { parseCalDavEvents } from "./caldav.js";
export {
  calendarConfig,
  assertCalendarTimezone,
  type CalendarConfig,
} from "./config.js";
export { cleanSecret } from "./secrets.js";
export { calendarRuntimeToken, type CalendarRuntime } from "./runtime.js";
export {
  OAuthTokenManager,
  OAuthTokenError,
  authCommandFor,
  type OAuthProviderKind,
  type RefreshTokenStore,
  type TokenManagerOptions,
  type TokenSet,
} from "./token-manager.js";
export {
  CalendarCredentialStore,
  type CalendarStateStore,
  type CredentialOwner,
  type StoredCredential,
} from "./credential-store.js";
export {
  CalendarAuthService,
  DEFAULT_OAUTH_CALLBACK_PATH,
  buildRedirectUri,
  localOriginFromAddress,
  parseOAuthProvider,
} from "./chat-auth.js";
export { OAuthSessionRegistry, OAUTH_SESSION_TTL_MS } from "./oauth-session.js";
export {
  buildAuthorizeUrl,
  createPkcePair,
  createOAuthState,
  exchangeAuthorizationCode,
  GOOGLE_AUTH_SCOPES,
  MICROSOFT_AUTH_SCOPES,
} from "./oauth-auth.js";
export { microsoftCalendarBase } from "./oauth.js";

export interface CalendarProviderDependencies {
  /** Token managers shared with the chat authorization flow. */
  readonly managers?: Partial<Record<OAuthProviderKind, OAuthTokenManager>>;
}

export interface TokenManagerDependencies {
  readonly credentials?: CalendarCredentialStore;
  readonly onAuthorizationLost?: AuthorizationLostListener;
}

/**
 * Creates one token manager per OAuth provider that has client credentials.
 * Stored (chat-authorized) refresh tokens win over config/env values.
 */
export function createOAuthTokenManagers(
  config: CalendarConfig,
  dependencies: TokenManagerDependencies = {}
): Partial<Record<OAuthProviderKind, OAuthTokenManager>> {
  const managers: Partial<Record<OAuthProviderKind, OAuthTokenManager>> = {};
  const google = config.google;
  const microsoft = config.microsoft;

  const googleClientId = cleanSecret(google?.client_id ?? "");
  const googleClientSecret = cleanSecret(google?.client_secret ?? "");
  if (googleClientId && googleClientSecret) {
    managers.google = new OAuthTokenManager({
      provider: "google",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      initialRefreshToken: cleanSecret(google?.refresh_token ?? ""),
      tokenFile: cleanSecret(google?.token_file ?? "") || undefined,
      tokenStore: dependencies.credentials?.refreshTokenStore("google"),
      onAuthorizationLost: dependencies.onAuthorizationLost,
    });
  }

  const microsoftClientId = cleanSecret(microsoft?.client_id ?? "");
  if (microsoftClientId) {
    managers.microsoft = new OAuthTokenManager({
      provider: "microsoft",
      clientId: microsoftClientId,
      clientSecret: cleanSecret(microsoft?.client_secret ?? "") || undefined,
      tenant: microsoft?.tenant || "common",
      initialRefreshToken: cleanSecret(microsoft?.refresh_token ?? ""),
      tokenFile: cleanSecret(microsoft?.token_file ?? "") || undefined,
      tokenStore: dependencies.credentials?.refreshTokenStore("microsoft"),
      onAuthorizationLost: dependencies.onAuthorizationLost,
    });
  }
  return managers;
}

/** Builds the configured provider, or `undefined` when none is enabled. */
export function createCalendarProvider(
  config: CalendarConfig,
  dependencies: CalendarProviderDependencies = {}
): CalendarProvider | undefined {
  const caldav = config.caldav;
  const google = config.google;
  const microsoft = config.microsoft;
  const managers = dependencies.managers;

  if (
    config.provider === "caldav" &&
    caldav?.enabled &&
    cleanSecret(caldav.calendar_url ?? "")
  ) {
    return createCalDavProvider({
      calendarUrl: cleanSecret(caldav.calendar_url ?? ""),
      username: cleanSecret(caldav.username ?? ""),
      password: cleanSecret(caldav.password ?? ""),
      timezone: config.timezone,
    });
  }

  if (config.provider === "google" && google?.enabled) {
    const calendarId = (google.calendar_id || "primary").trim() || "primary";
    const sharedManager = managers?.google;
    if (sharedManager) {
      return createGoogleCalendarProvider({
        clientId: cleanSecret(google.client_id ?? ""),
        tokenManager: sharedManager,
        calendarId,
        timezone: config.timezone,
      });
    }
    const clientId = cleanSecret(google.client_id ?? "");
    const clientSecret = cleanSecret(google.client_secret ?? "");
    const refreshToken = cleanSecret(google.refresh_token ?? "");
    if (!clientId || !clientSecret || !refreshToken) {
      return undefined;
    }
    return createGoogleCalendarProvider({
      clientId,
      clientSecret,
      refreshToken,
      calendarId,
      timezone: config.timezone,
      tokenFile: cleanSecret(google.token_file ?? "") || undefined,
    });
  }

  if (config.provider === "microsoft" && microsoft?.enabled) {
    const calendarId = (microsoft.calendar_id ?? "").trim();
    const sharedManager = managers?.microsoft;
    if (sharedManager) {
      return createMicrosoftCalendarProvider({
        clientId: cleanSecret(microsoft.client_id ?? ""),
        tokenManager: sharedManager,
        calendarId,
        timezone: config.timezone,
      });
    }
    const clientId = cleanSecret(microsoft.client_id ?? "");
    const refreshToken = cleanSecret(microsoft.refresh_token ?? "");
    if (!clientId || !refreshToken) {
      return undefined;
    }
    return createMicrosoftCalendarProvider({
      clientId,
      clientSecret: cleanSecret(microsoft.client_secret ?? "") || undefined,
      refreshToken,
      calendarId,
      timezone: config.timezone,
      tenant: microsoft.tenant || "common",
      tokenFile: cleanSecret(microsoft.token_file ?? "") || undefined,
    });
  }
  return undefined;
}
