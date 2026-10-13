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
  if (
    config.provider === "google" &&
    google?.enabled &&
    cleanSecret(google.access_token ?? "")
  ) {
    return createGoogleCalendarProvider({
      accessToken: cleanSecret(google.access_token ?? ""),
      refreshToken: cleanSecret(google.refresh_token ?? ""),
      clientId: cleanSecret(google.client_id ?? ""),
      clientSecret: cleanSecret(google.client_secret ?? ""),
      calendarId: google.calendar_id || "primary",
      timezone: config.timezone,
    });
  }
  if (
    config.provider === "microsoft" &&
    microsoft?.enabled &&
    cleanSecret(microsoft.access_token ?? "")
  ) {
    return createMicrosoftCalendarProvider({
      accessToken: cleanSecret(microsoft.access_token ?? ""),
      refreshToken: cleanSecret(microsoft.refresh_token ?? ""),
      clientId: cleanSecret(microsoft.client_id ?? ""),
      clientSecret: cleanSecret(microsoft.client_secret ?? ""),
      calendarId: microsoft.calendar_id ?? "",
      timezone: config.timezone,
      tenant: microsoft.tenant || "common",
    });
  }
  return undefined;
}
