import type { CalendarConfig } from "./config.js";
import { cleanSecret } from "./secrets.js";
import { createCalDavProvider } from "./caldav.js";
import {
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from "./oauth.js";
import type { CalendarProvider } from "./types.js";

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
  type TokenManagerOptions,
  type TokenSet,
} from "./token-manager.js";
export {
  buildAuthorizeUrl,
  createPkcePair,
  createOAuthState,
  exchangeAuthorizationCode,
  GOOGLE_AUTH_SCOPES,
  MICROSOFT_AUTH_SCOPES,
} from "./oauth-auth.js";
export { microsoftCalendarBase } from "./oauth.js";

/** Builds the configured provider, or `undefined` when none is enabled. */
export function createCalendarProvider(
  config: CalendarConfig
): CalendarProvider | undefined {
  const caldav = config.caldav;
  const google = config.google;
  const microsoft = config.microsoft;

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
    const clientId = cleanSecret(google.client_id ?? "");
    const clientSecret = cleanSecret(google.client_secret ?? "");
    const refreshToken = cleanSecret(google.refresh_token ?? "");
    if (!clientId || !clientSecret || !refreshToken) return undefined;
    return createGoogleCalendarProvider({
      clientId,
      clientSecret,
      refreshToken,
      calendarId: (google.calendar_id || "primary").trim() || "primary",
      timezone: config.timezone,
      tokenFile: cleanSecret(google.token_file ?? "") || undefined,
    });
  }
  if (config.provider === "microsoft" && microsoft?.enabled) {
    const clientId = cleanSecret(microsoft.client_id ?? "");
    const refreshToken = cleanSecret(microsoft.refresh_token ?? "");
    if (!clientId || !refreshToken) return undefined;
    return createMicrosoftCalendarProvider({
      clientId,
      clientSecret: cleanSecret(microsoft.client_secret ?? "") || undefined,
      refreshToken,
      calendarId: (microsoft.calendar_id ?? "").trim(),
      timezone: config.timezone,
      tenant: microsoft.tenant || "common",
      tokenFile: cleanSecret(microsoft.token_file ?? "") || undefined,
    });
  }
  return undefined;
}
