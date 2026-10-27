import listEvents from '../skills/calendar-scheduling/tools/list_events/index.js';
import createEvent from '../skills/calendar-scheduling/tools/create_event/index.js';
import findFreeTime from '../skills/calendar-scheduling/tools/find_free_time/index.js';
import { createGoogleCalendarProvider, createMicrosoftCalendarProvider } from '../src/oauth.js';
import { createCalDavProvider } from '../src/caldav.js';
import { CalendarError } from '../src/errors.js';
import { runCalendarTool } from '../src/tool-errors.js';
import { OAuthTokenManager } from '../src/token-manager.js';
import { parseDuration } from '../src/time.js';
import type { CalendarProvider } from '../src/types.js';

const range = { from: '2026-10-27T09:00', to: '2026-10-27T18:00' };
const tokenManager = { hydrate: async () => {}, getAccessToken: async () => 'synthetic' } as OAuthTokenManager;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function context(provider: CalendarProvider, locale: 'en' | 'zh-CN' = 'en', workDayStart = '09:00') {
  return { locale, use: () => ({ provider, config: { timezone: 'UTC', work_day_start: workDayStart, work_day_end: '18:00' } }) } as never;
}

it.each(['google', 'microsoft', 'caldav'] as const)('preserves missing and explicit %s titles until the tool presentation boundary', async kind => {
  let provider: CalendarProvider;
  if (kind === 'caldav') {
    const events = [undefined, '(无标题)'].map((title, i) => ['BEGIN:VEVENT', `UID:event${i}`, ...(title === undefined ? [] : [`SUMMARY:${title}`]), 'DTSTART:20261027T100000Z', 'DTEND:20261027T110000Z', 'END:VEVENT'].join('\n')).join('\n');
    provider = createCalDavProvider({ calendarUrl: 'https://example.com/calendar', username: 'fixture', password: 'fixture', timezone: 'UTC', fetchImpl: async () => new Response(`<C:calendar-data>${events}</C:calendar-data>`) });
  } else {
    const events = [undefined, '(无标题)'].map((title, i) => ({ id: `event${i}`, ...(title === undefined ? {} : { summary: title, subject: title }), start: { dateTime: '2026-10-27T10:00:00Z' }, end: { dateTime: '2026-10-27T11:00:00Z' } }));
    provider = (kind === 'google' ? createGoogleCalendarProvider : createMicrosoftCalendarProvider)({ clientId: 'fixture', calendarId: 'primary', timezone: 'UTC', tokenManager, fetchImpl: async () => json(kind === 'google' ? { items: events } : { value: events }) });
  }
  const stored = await provider.listEvents(new Date(range.from + 'Z'), new Date(range.to + 'Z'));
  expect(stored.map(event => event.title)).toEqual(['', '(无标题)']);
  const english = await listEvents.execute(range, context(provider));
  expect(english).toContain('(Untitled)  [event0]');
  expect(english).toContain('(无标题)  [event1]');
  const chinese = await listEvents.execute(range, context(provider, 'zh-CN'));
  expect(chinese).not.toContain('(Untitled)');
});

it('localizes owned input failures while retaining failure codes and not invoking providers', async () => {
  const provider = { name: 'fixture', listEvents: vi.fn(async () => []), createEvent: vi.fn() };
  await expect(listEvents.execute({ ...range, from: 'not-a-time' }, context(provider))).rejects.toMatchObject({ code: 'datetimeFormat', message: 'Could not parse datetime: not-a-time (use YYYY-MM-DDTHH:mm)' });
  expect(provider.listEvents).not.toHaveBeenCalled();
  await expect(createEvent.execute({ title: '原始标题', start: 'badZ', end: range.to }, context(provider))).rejects.toMatchObject({ code: 'datetime', message: 'Could not parse datetime: badZ' });
  expect(provider.createEvent).not.toHaveBeenCalled();
  await expect(findFreeTime.execute({ ...range, duration_minutes: 30 }, context(provider, 'en', 'bad'))).rejects.toMatchObject({ code: 'workTime', message: 'Invalid work time: bad (example: 09:00)' });
  await expect(runCalendarTool(async () => String(parseDuration('bad')), 'en')).rejects.toMatchObject({ code: 'duration', message: 'Could not parse duration: bad (examples: 10m, 2h30m, 1d)' });
});

it('localizes provider wrappers while keeping raw service errors and unknown exceptions unchanged', async () => {
  const provider = createGoogleCalendarProvider({ clientId: 'fixture', calendarId: 'primary', timezone: 'UTC', tokenManager, fetchImpl: async () => new Response('原始服务响应', { status: 503 }) });
  await expect(listEvents.execute(range, context(provider))).rejects.toMatchObject({ code: 'listHttp', message: 'Google Calendar could not list events: HTTP 503 原始服务响应' });
  await expect(createEvent.execute({ title: '原始标题', start: range.from, end: range.to }, context(provider))).rejects.toMatchObject({ code: 'createHttp', message: 'Google Calendar could not create the event: HTTP 503' });
  const thirdParty = new Error('无法解析时间：这是第三方原文');
  await expect(runCalendarTool(async () => { throw thirdParty; }, 'en')).rejects.toBe(thirdParty);
  await expect(runCalendarTool(async () => { throw new CalendarError('timezone', { value: 'Fixture' }); }, 'en')).rejects.toMatchObject({ code: 'timezone', message: 'Unknown timezone: Fixture' });
});

it('keeps OAuth error codes and raw provider detail while localizing refresh failures', async () => {
  const manager = new OAuthTokenManager({ provider: 'microsoft', clientId: 'fixture', initialRefreshToken: 'fixture', fetchImpl: async () => json({ error: 'server_error', error_description: '原始服务错误' }, 503) });
  expect(await runCalendarTool(() => manager.getAccessToken(), 'en')).toBe('microsoft: token refresh failed, HTTP 503: 原始服务错误');
});
