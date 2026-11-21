import { describe, expect, it } from 'vitest';
import { createCalDavProvider } from '../src/caldav.js';
import { createGoogleCalendarProvider, createMicrosoftCalendarProvider } from '../src/oauth.js';
import { dateInZone, parseDateTimeInZone } from '../src/time.js';
import type { OAuthTokenManager } from '../src/token-manager.js';

const ZONE = 'Asia/Shanghai';
const tokenManager = { hydrate: async () => {}, getAccessToken: async () => 'synthetic' } as OAuthTokenManager;

// The create_event tool parses an all-day day as midnight in the configured zone: 2026-01-05T16:00Z.
function allDay() {
  return {
    title: 'Holiday',
    start: parseDateTimeInZone('2026-01-06', ZONE),
    end: parseDateTimeInZone('2026-01-07', ZONE),
    all_day: true,
  };
}

function capture(response: () => Response) {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return response();
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe('all-day event dates (#1250)', () => {
  it('takes the calendar day in the configured zone, not the UTC day', () => {
    expect(dateInZone(allDay().start, ZONE)).toBe('2026-01-06');
    expect(dateInZone(new Date('2026-01-05T16:00:00Z'), 'UTC')).toBe('2026-01-05');
  });

  it('sends the configured-zone day to Google Calendar', async () => {
    const { bodies, fetchImpl } = capture(() => new Response(JSON.stringify({ id: 'e1', summary: 'Holiday', start: { date: '2026-01-06' }, end: { date: '2026-01-07' } })));
    await createGoogleCalendarProvider({ clientId: 'fixture', calendarId: 'primary', timezone: ZONE, tokenManager, fetchImpl }).createEvent(allDay());
    const body = JSON.parse(bodies[0]!);
    expect(body.start).toEqual({ date: '2026-01-06' });
    expect(body.end).toEqual({ date: '2026-01-07' });
  });

  it('sends midnight of the configured-zone day to Microsoft Graph', async () => {
    const { bodies, fetchImpl } = capture(() => new Response(JSON.stringify({ id: 'e1', subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-01-06T00:00:00' }, end: { dateTime: '2026-01-07T00:00:00' } })));
    await createMicrosoftCalendarProvider({ clientId: 'fixture', calendarId: 'primary', timezone: ZONE, tokenManager, fetchImpl }).createEvent(allDay());
    const body = JSON.parse(bodies[0]!);
    expect(body.start).toEqual({ dateTime: '2026-01-06T00:00:00', timeZone: ZONE });
    expect(body.end).toEqual({ dateTime: '2026-01-07T00:00:00', timeZone: ZONE });
    expect(body.isAllDay).toBe(true);
  });

  it('writes the configured-zone day into the CalDAV VEVENT', async () => {
    const { bodies, fetchImpl } = capture(() => new Response(null, { status: 201 }));
    await createCalDavProvider({ calendarUrl: 'https://example.com/calendar/', username: 'fixture', password: 'fixture', timezone: ZONE, fetchImpl }).createEvent(allDay());
    expect(bodies[0]).toContain('DTSTART;VALUE=DATE:20260106');
    expect(bodies[0]).toContain('DTEND;VALUE=DATE:20260107');
  });

  it('keeps timed events as UTC instants', async () => {
    const { bodies, fetchImpl } = capture(() => new Response(null, { status: 201 }));
    const start = parseDateTimeInZone('2026-01-06T09:00', ZONE);
    await createCalDavProvider({ calendarUrl: 'https://example.com/calendar/', username: 'fixture', password: 'fixture', timezone: ZONE, fetchImpl }).createEvent({ title: 'Meet', start, end: new Date(start.getTime() + 3_600_000) });
    expect(bodies[0]).toContain('DTSTART:20260106T010000Z');
  });
});
