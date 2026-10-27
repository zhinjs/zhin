import { CalendarError } from './errors.js';
/**
 * Minimal CalDAV client (RFC 4791) for listing and creating VEVENTs.
 * Works with iCloud, Fastmail and Nextcloud calendars.
 */
import { randomUUID } from "node:crypto";
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

/** Returns the text content of every `<href>` element (any namespace prefix). */
export function extractHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const tagStart = xml.indexOf("<", cursor);
    if (tagStart === -1) {
      break;
    }
    const tagEnd = xml.indexOf(">", tagStart);
    if (tagEnd === -1) {
      break;
    }
    const tagName = readTagName(xml.slice(tagStart + 1, tagEnd));
    cursor = tagEnd + 1;
    if (localName(tagName) !== "href") {
      continue;
    }
    const closingStart = xml.indexOf("</", cursor);
    if (closingStart === -1) {
      break;
    }
    const value = xml.slice(cursor, closingStart).trim();
    if (value) {
      hrefs.push(value);
    }
    cursor = closingStart;
  }
  return hrefs;
}

function readTagName(tagContent: string): string {
  if (tagContent.startsWith("/") || tagContent.startsWith("?")) {
    return "";
  }
  let end = 0;
  while (end < tagContent.length && !/[\s/]/.test(tagContent[end]!)) {
    end += 1;
  }
  return tagContent.slice(0, end);
}

function localName(tagName: string): string {
  const colonIndex = tagName.lastIndexOf(":");
  return tagName.slice(colonIndex + 1).toLowerCase();
}

/** Returns the body between each BEGIN:VEVENT / END:VEVENT pair. */
export function extractVeventBlocks(text: string): string[] {
  const beginMarker = "BEGIN:VEVENT";
  const endMarker = "END:VEVENT";
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const begin = text.indexOf(beginMarker, cursor);
    if (begin === -1) {
      break;
    }
    const bodyStart = begin + beginMarker.length;
    const end = text.indexOf(endMarker, bodyStart);
    if (end === -1) {
      break;
    }
    blocks.push(text.slice(bodyStart, end));
    cursor = end + endMarker.length;
  }
  return blocks;
}

/** Parses VEVENT components from a CalDAV multistatus response. */
export function parseCalDavEvents(
  xml: string,
  timezone: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const hrefs = extractHrefs(xml);
  const blocks = extractVeventBlocks(xml);
  blocks.forEach((block, index) => {
    const uid = extractField(block, "UID") ?? hrefs[index] ?? `event-${index}`;
    const summary = extractField(block, "SUMMARY") ?? "";
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
        throw new CalendarError('caldavHttp', { method: 'REPORT', status: response.status });
      return parseCalDavEvents(await response.text(), options.timezone);
    },
    async createEvent(input, signal) {
      const uid = `${randomUUID()}@zhin`;
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
        throw new CalendarError('caldavHttp', { method: 'PUT', status: response.status });
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
