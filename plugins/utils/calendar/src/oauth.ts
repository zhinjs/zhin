import { CalendarError } from './errors.js';
/**
 * Google Calendar and Microsoft Graph providers backed by OAuthTokenManager
 * (refresh_token flow; access tokens are never stored in config).
 */
import type {
  CalendarEvent,
  CalendarProvider,
  CreateEventInput,
} from "./types.js";
import { formatInZone } from "./time.js";
import {
  OAuthTokenManager,
  type AuthorizationLostListener,
  type RefreshTokenStore,
  type TokenManagerLogger,
} from "./token-manager.js";

export interface OAuthCalendarOptions {
  readonly clientId: string;
  readonly clientSecret?: string;
  /** Fallback refresh token from config/env. */
  readonly refreshToken?: string;
  readonly tokenStore?: RefreshTokenStore;
  readonly onAuthorizationLost?: AuthorizationLostListener;
  /** Use an existing manager (shared with the chat auth flow) instead of creating one. */
  readonly tokenManager?: OAuthTokenManager;
  readonly calendarId: string;
  readonly timezone: string;
  readonly tenant?: string;
  /** Optional JSON file to persist rotated refresh tokens. */
  readonly tokenFile?: string;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: TokenManagerLogger;
}

function mapGoogleEvent(
  item: Record<string, unknown>,
  timezone: string
): CalendarEvent {
  const start = (item.start as { dateTime?: string; date?: string }) ?? {};
  const end = (item.end as { dateTime?: string; date?: string }) ?? {};
  const startDate = new Date(start.dateTime ?? start.date ?? "");
  const endDate = new Date(end.dateTime ?? end.date ?? "");
  return {
    id: String(item.id ?? ""),
    title: String(item.summary ?? ""),
    start: formatInZone(startDate, timezone),
    end: formatInZone(endDate, timezone),
    location: item.location ? String(item.location) : undefined,
    description: item.description ? String(item.description) : undefined,
    all_day: Boolean(start.date && !start.dateTime),
  };
}

function mapMicrosoftEvent(
  item: Record<string, unknown>,
  timezone: string
): CalendarEvent {
  const start = (item.start as { dateTime?: string }) ?? {};
  const end = (item.end as { dateTime?: string }) ?? {};
  const startRaw = start.dateTime ?? "";
  const endRaw = end.dateTime ?? "";
  const startDate = new Date(
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(startRaw) ? startRaw : `${startRaw}Z`
  );
  const endDate = new Date(
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(endRaw) ? endRaw : `${endRaw}Z`
  );
  return {
    id: String(item.id ?? ""),
    title: String(item.subject ?? ""),
    start: formatInZone(startDate, timezone),
    end: formatInZone(endDate, timezone),
    location: item.location
      ? String((item.location as { displayName?: string }).displayName ?? "")
      : undefined,
    description: item.bodyPreview ? String(item.bodyPreview) : undefined,
    all_day: Boolean(item.isAllDay),
  };
}

async function withBearer(
  manager: OAuthTokenManager,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const token = await manager.getAccessToken();
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    ...extraHeaders,
    authorization: `Bearer ${token}`,
  };
  let response = await fetchImpl(url, { ...init, headers });
  if (response.status === 401) {
    const fresh = await manager.forceRefresh();
    response = await fetchImpl(url, {
      ...init,
      headers: { ...headers, authorization: `Bearer ${fresh}` },
    });
  }
  return response;
}

export function createGoogleCalendarProvider(
  options: OAuthCalendarOptions
): CalendarProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const manager =
    options.tokenManager ??
    new OAuthTokenManager({
      provider: "google",
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      initialRefreshToken: options.refreshToken,
      tokenFile: options.tokenFile,
      fetchImpl,
      logger: options.logger,
      tokenStore: options.tokenStore,
      onAuthorizationLost: options.onAuthorizationLost,
    });
  const calendarId = encodeURIComponent(options.calendarId.trim() || "primary");
  let hydrated = false;
  async function ensureHydrated(): Promise<void> {
    if (hydrated) return;
    await manager.hydrate();
    hydrated = true;
  }

  return {
    name: "google",
    async listEvents(from, to, signal) {
      await ensureHydrated();
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`
      );
      url.searchParams.set("timeMin", from.toISOString());
      url.searchParams.set("timeMax", to.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      const response = await withBearer(manager, fetchImpl, url.toString(), {
        signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new CalendarError('listHttp', { provider: 'Google Calendar', status: response.status, detail });
      }
      const data = (await response.json()) as {
        items?: Record<string, unknown>[];
      };
      return (data.items ?? []).map((item) =>
        mapGoogleEvent(item, options.timezone)
      );
    },
    async createEvent(input, signal) {
      await ensureHydrated();
      const body = {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: input.all_day
          ? { date: input.start.toISOString().slice(0, 10) }
          : { dateTime: input.start.toISOString(), timeZone: options.timezone },
        end: input.all_day
          ? { date: input.end.toISOString().slice(0, 10) }
          : { dateTime: input.end.toISOString(), timeZone: options.timezone },
      };
      const response = await withBearer(
        manager,
        fetchImpl,
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }
      );
      if (!response.ok)
        throw new CalendarError('createHttp', { provider: 'Google Calendar', status: response.status });
      return mapGoogleEvent(
        (await response.json()) as Record<string, unknown>,
        options.timezone
      );
    },
  };
}

/** Default calendar when id empty / primary / me. */
export function microsoftCalendarBase(calendarId: string): string {
  const id = calendarId.trim();
  if (!id || id === "primary" || id === "me") {
    return "https://graph.microsoft.com/v1.0/me/calendar";
  }
  return `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
    id
  )}`;
}

export function createMicrosoftCalendarProvider(
  options: OAuthCalendarOptions
): CalendarProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const manager =
    options.tokenManager ??
    new OAuthTokenManager({
      provider: "microsoft",
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      tenant: options.tenant,
      initialRefreshToken: options.refreshToken,
      tokenFile: options.tokenFile,
      fetchImpl,
      logger: options.logger,
      tokenStore: options.tokenStore,
      onAuthorizationLost: options.onAuthorizationLost,
    });
  const base = microsoftCalendarBase(options.calendarId);
  let hydrated = false;
  async function ensureHydrated(): Promise<void> {
    if (hydrated) return;
    await manager.hydrate();
    hydrated = true;
  }

  return {
    name: "microsoft",
    async listEvents(from, to, signal) {
      await ensureHydrated();
      const url = new URL(`${base}/calendarView`);
      url.searchParams.set("startDateTime", from.toISOString());
      url.searchParams.set("endDateTime", to.toISOString());
      url.searchParams.set("$orderby", "start/dateTime");
      url.searchParams.set("$top", "50");
      const response = await withBearer(
        manager,
        fetchImpl,
        url.toString(),
        { signal },
        {
          prefer: `outlook.timezone="${options.timezone}"`,
        }
      );
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new CalendarError('listHttp', { provider: 'Microsoft Graph', status: response.status, detail });
      }
      const data = (await response.json()) as {
        value?: Record<string, unknown>[];
      };
      return (data.value ?? []).map((item) =>
        mapMicrosoftEvent(item, options.timezone)
      );
    },
    async createEvent(input, signal) {
      await ensureHydrated();
      const body = {
        subject: input.title,
        body: input.description
          ? { contentType: "Text", content: input.description }
          : undefined,
        location: input.location ? { displayName: input.location } : undefined,
        start: {
          dateTime: input.start.toISOString().replace(/\.\d{3}Z$/, ""),
          timeZone: "UTC",
        },
        end: {
          dateTime: input.end.toISOString().replace(/\.\d{3}Z$/, ""),
          timeZone: "UTC",
        },
        isAllDay: Boolean(input.all_day),
      };
      const response = await withBearer(
        manager,
        fetchImpl,
        `${base}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
        { prefer: `outlook.timezone="${options.timezone}"` }
      );
      if (!response.ok)
        throw new CalendarError('createHttp', { provider: 'Microsoft Graph', status: response.status });
      return mapMicrosoftEvent(
        (await response.json()) as Record<string, unknown>,
        options.timezone
      );
    },
  };
}
