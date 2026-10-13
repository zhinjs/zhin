/**
 * Minimal CalDAV client (RFC 4791) for listing and creating VEVENTs.
 * Works with iCloud, Fastmail and Nextcloud calendars.
 */
import type {
  CalendarEvent,
  CalendarProvider,
  CreateEventInput,
} from "./types.js";
import { formatInZone } from "./time.js";

export interface CalDavOptions {
  readonly calendarUrl: string;
  readonly username: string;
  readonly password: string;
  readonly timezone: string;
  readonly fetchImpl?: typeof fetch;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toUtcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function parseIcsDate(value: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(
    value.trim()
  );
  if (!match) return new Date(NaN);
  if (!match[4]) {
    return new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    );
  }
  const utc = match[7] === "Z";
  const parts = [
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  ] as const;
  return utc ? new Date(Date.UTC(...parts)) : new Date(...parts);
}

function extractField(block: string, name: string): string | undefined {
  const pattern = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "im");
  const match = pattern.exec(block);
  return match
    ? match[1]!.trim().replace(/\\n/g, "\n").replace(/\\,/g, ",")
    : undefined;
}

/** Parses VEVENT components from a CalDAV multistatus response. */
export function parseCalDavEvents(
  xml: string,
  timezone: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const hrefs = [
    ...xml.matchAll(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/gi),
  ].map((m) => m[1]!.trim());
  const calendars = [...xml.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)];
  calendars.forEach((match, index) => {
    const block = match[1]!;
    const uid = extractField(block, "UID") ?? hrefs[index] ?? `event-${index}`;
    const summary = extractField(block, "SUMMARY") ?? "(无标题)";
    const startRaw = extractField(block, "DTSTART");
    const endRaw = extractField(block, "DTEND") ?? startRaw;
    if (!startRaw || !endRaw) return;
    const start = parseIcsDate(startRaw);
    const end = parseIcsDate(endRaw);
    const allDay = !/T/.test(startRaw);
    events.push({
      id: uid,
      title: summary,
      start: formatInZone(start, timezone),
      end: formatInZone(end, timezone),
      location: extractField(block, "LOCATION"),
      description: extractField(block, "DESCRIPTION"),
      all_day: allDay,
    });
  });
  return events;
}

function buildVevent(input: CreateEventInput, uid: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zhin.js-assistant-toolkit//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    input.all_day
      ? `DTSTART;VALUE=DATE:${input.start
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "")}`
      : `DTSTART:${toUtcStamp(input.start)}`,
    input.all_day
      ? `DTEND;VALUE=DATE:${input.end
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "")}`
      : `DTEND:${toUtcStamp(input.end)}`,
    `SUMMARY:${input.title.replace(/\n/g, " ")}`,
  ];
  if (input.location)
    lines.push(`LOCATION:${input.location.replace(/\n/g, " ")}`);
  if (input.description)
    lines.push(`DESCRIPTION:${input.description.replace(/\n/g, "\\n")}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function createCalDavProvider(options: CalDavOptions): CalendarProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = basicAuth(options.username, options.password);
  const base = options.calendarUrl.endsWith("/")
    ? options.calendarUrl
    : `${options.calendarUrl}/`;

  return {
    name: "caldav",
    async listEvents(from, to, signal) {
      const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${toUtcStamp(from)}" end="${toUtcStamp(to)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
      const response = await fetchImpl(base, {
        method: "REPORT",
        headers: {
          authorization: auth,
          depth: "1",
          "content-type": "application/xml; charset=utf-8",
        },
        body,
        signal,
      });
      if (!response.ok)
        throw new Error(`CalDAV REPORT 失败：HTTP ${response.status}`);
      return parseCalDavEvents(await response.text(), options.timezone);
    },
    async createEvent(input, signal) {
      const uid = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}@zhin`;
      const url = new URL(`${uid}.ics`, base).toString();
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: {
          authorization: auth,
          "content-type": "text/calendar; charset=utf-8",
          "if-none-match": "*",
        },
        body: buildVevent(input, uid),
        signal,
      });
      if (response.status !== 201 && response.status !== 204) {
        throw new Error(`CalDAV PUT 失败：HTTP ${response.status}`);
      }
      return {
        id: uid,
        title: input.title,
        start: formatInZone(input.start, options.timezone),
        end: formatInZone(input.end, options.timezone),
        location: input.location,
        description: input.description,
        all_day: input.all_day,
      };
    },
  };
}

export { escapeXml };
