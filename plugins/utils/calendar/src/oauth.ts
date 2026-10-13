/**
 * Google Calendar and Microsoft Graph adapters using a pre-issued access token
 * (and optional refresh). Tokens come from env vars — this plugin never
 * starts an OAuth dance itself.
 */
import type {
  CalendarEvent,
  CalendarProvider,
  CreateEventInput,
} from "./types.js";
import { formatInZone } from "./time.js";

export interface OAuthCalendarOptions {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly calendarId: string;
  readonly timezone: string;
  readonly tenant?: string;
  readonly fetchImpl?: typeof fetch;
}

async function refreshGoogleToken(
  options: OAuthCalendarOptions,
  fetchImpl: typeof fetch
): Promise<string> {
  if (!options.refreshToken || !options.clientId || !options.clientSecret) {
    throw new Error(
      "Google access_token 已失效且未配置 refresh_token / client_id / client_secret"
    );
  }
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: options.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok)
    throw new Error(`Google token 刷新失败：HTTP ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("Google token 刷新响应缺少 access_token");
  return data.access_token;
}

async function refreshMicrosoftToken(
  options: OAuthCalendarOptions,
  fetchImpl: typeof fetch
): Promise<string> {
  if (!options.refreshToken || !options.clientId || !options.clientSecret) {
    throw new Error(
      "Microsoft access_token 已失效且未配置 refresh_token / client_id / client_secret"
    );
  }
  const tenant = options.tenant || "common";
  const response = await fetchImpl(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        refresh_token: options.refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/.default offline_access",
      }),
    }
  );
  if (!response.ok)
    throw new Error(`Microsoft token 刷新失败：HTTP ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("Microsoft token 刷新响应缺少 access_token");
  return data.access_token;
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
    title: String(item.summary ?? "(无标题)"),
    start: formatInZone(startDate, timezone),
    end: formatInZone(endDate, timezone),
    location: item.location ? String(item.location) : undefined,
    description: item.description ? String(item.description) : undefined,
    all_day: Boolean(start.date && !start.dateTime),
  };
}

export function createGoogleCalendarProvider(
  options: OAuthCalendarOptions
): CalendarProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  let token = options.accessToken;
  const calendarId = encodeURIComponent(options.calendarId || "primary");

  async function authorized(url: string, init: RequestInit): Promise<Response> {
    const headers = {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${token}`,
    };
    let response = await fetchImpl(url, { ...init, headers });
    if (response.status === 401) {
      token = await refreshGoogleToken(options, fetchImpl);
      response = await fetchImpl(url, {
        ...init,
        headers: { ...headers, authorization: `Bearer ${token}` },
      });
    }
    return response;
  }

  return {
    name: "google",
    async listEvents(from, to, signal) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`
      );
      url.searchParams.set("timeMin", from.toISOString());
      url.searchParams.set("timeMax", to.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      const response = await authorized(url.toString(), { signal });
      if (!response.ok)
        throw new Error(`Google Calendar 列表失败：HTTP ${response.status}`);
      const data = (await response.json()) as {
        items?: Record<string, unknown>[];
      };
      return (data.items ?? []).map((item) =>
        mapGoogleEvent(item, options.timezone)
      );
    },
    async createEvent(input, signal) {
      const body = {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: input.all_day
          ? { date: input.start.toISOString().slice(0, 10) }
          : { dateTime: input.start.toISOString() },
        end: input.all_day
          ? { date: input.end.toISOString().slice(0, 10) }
          : { dateTime: input.end.toISOString() },
      };
      const response = await authorized(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }
      );
      if (!response.ok)
        throw new Error(`Google Calendar 创建失败：HTTP ${response.status}`);
      return mapGoogleEvent(
        (await response.json()) as Record<string, unknown>,
        options.timezone
      );
    },
  };
}

function mapMicrosoftEvent(
  item: Record<string, unknown>,
  timezone: string
): CalendarEvent {
  const start = (item.start as { dateTime?: string }) ?? {};
  const end = (item.end as { dateTime?: string }) ?? {};
  return {
    id: String(item.id ?? ""),
    title: String(item.subject ?? "(无标题)"),
    start: formatInZone(new Date(start.dateTime ?? ""), timezone),
    end: formatInZone(new Date(end.dateTime ?? ""), timezone),
    location: item.location
      ? String((item.location as { displayName?: string }).displayName ?? "")
      : undefined,
    description: item.bodyPreview ? String(item.bodyPreview) : undefined,
    all_day: Boolean(item.isAllDay),
  };
}

export function createMicrosoftCalendarProvider(
  options: OAuthCalendarOptions
): CalendarProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  let token = options.accessToken;

  async function authorized(url: string, init: RequestInit): Promise<Response> {
    const headers = {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${token}`,
      prefer: `outlook.timezone="${options.timezone}"`,
    };
    let response = await fetchImpl(url, { ...init, headers });
    if (response.status === 401) {
      token = await refreshMicrosoftToken(options, fetchImpl);
      response = await fetchImpl(url, {
        ...init,
        headers: { ...headers, authorization: `Bearer ${token}` },
      });
    }
    return response;
  }

  return {
    name: "microsoft",
    async listEvents(from, to, signal) {
      const url = new URL("https://graph.microsoft.com/v1.0/me/calendarview");
      url.searchParams.set("startDateTime", from.toISOString());
      url.searchParams.set("endDateTime", to.toISOString());
      url.searchParams.set("$orderby", "start/dateTime");
      url.searchParams.set("$top", "50");
      const response = await authorized(url.toString(), { signal });
      if (!response.ok)
        throw new Error(`Microsoft Graph 列表失败：HTTP ${response.status}`);
      const data = (await response.json()) as {
        value?: Record<string, unknown>[];
      };
      return (data.value ?? []).map((item) =>
        mapMicrosoftEvent(item, options.timezone)
      );
    },
    async createEvent(input, signal) {
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
      const response = await authorized(
        "https://graph.microsoft.com/v1.0/me/events",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }
      );
      if (!response.ok)
        throw new Error(`Microsoft Graph 创建失败：HTTP ${response.status}`);
      return mapMicrosoftEvent(
        (await response.json()) as Record<string, unknown>,
        options.timezone
      );
    },
  };
}
