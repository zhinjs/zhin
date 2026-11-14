import { describe, expect, it } from 'vitest';
import { PluginConsoleRpcError, type PluginConsoleRpcCall } from 'zhin.js';
import {
  CalendarAuthService,
  calendarRuntimeToken,
  createCalendarConsoleRpc,
  type CalendarConfig,
  type CalendarProvider,
  type CalendarRuntime,
} from '../src/index.js';
import CalendarPage, { meta } from '../pages/index/index.js';

function createCall(runtime?: CalendarRuntime): PluginConsoleRpcCall {
  return {
    signal: new AbortController().signal,
    runtime: runtime
      ? ({
          owner: 'root/calendar',
          generation: 1,
          operator: true,
          project: () => undefined,
          use: (token: unknown) => (token === calendarRuntimeToken ? runtime : undefined),
        } as unknown as NonNullable<PluginConsoleRpcCall['runtime']>)
      : undefined,
  };
}

describe('Calendar Console RPC & Declarative Page', () => {
  it('returns status from createCalendarConsoleRpc without leaking credentials', () => {
    const config: CalendarConfig = {
      provider: 'google',
      timezone: 'Asia/Shanghai',
      work_day_start: '09:30',
      work_day_end: '18:30',
      oauth_redirect_base_url: '',
      oauth_callback_path: '',
      caldav: { enabled: false, calendar_url: '', username: '', password: '' },
      google: {
        enabled: true,
        client_id: 'cid',
        client_secret: 'csec',
        refresh_token: 'rtok',
        calendar_id: 'primary',
        token_file: '',
      },
      microsoft: {
        enabled: false,
        client_id: '',
        client_secret: '',
        refresh_token: '',
        tenant: 'common',
        calendar_id: '',
        token_file: '',
      },
    };
    const fakeProvider: CalendarProvider = {
      listEvents: async () => [],
      createEvent: async () => ({ id: '1', summary: 'Test', start: '', end: '' }),
    };
    const auth = new CalendarAuthService({
      config,
      managers: {},
      credentials: undefined,
      notify: undefined,
      resolveRedirectUri: () => undefined,
    });
    const runtime: CalendarRuntime = {
      config,
      provider: fakeProvider,
      auth,
    };

    const rpc = createCalendarConsoleRpc();
    const statusMethod = rpc.methods.get('status')!;
    expect(statusMethod.page).toBe('index');
    expect(statusMethod.requiredPermissions).toEqual(['calendar:read']);

    const status = statusMethod.handler({}, createCall(runtime));
    expect(status).toEqual({
      provider: 'google',
      timezone: 'Asia/Shanghai',
      ready: true,
      oauthCallbackPath: '/calendar/oauth/callback',
      workingHours: '09:30 - 18:30',
    });
    expect(JSON.stringify(status)).not.toContain('csec');
    expect(JSON.stringify(status)).not.toContain('rtok');
  });

  it('throws PluginConsoleRpcError when runtime is missing', () => {
    const rpc = createCalendarConsoleRpc();
    const statusMethod = rpc.methods.get('status')!;
    expect(() => statusMethod.handler({}, createCall())).toThrow(PluginConsoleRpcError);
  });

  it('exports page meta and declarative page component', () => {
    expect(meta).toMatchObject({
      title: '日历日程',
      titleI18n: { en: 'Calendar' },
      icon: 'Calendar',
      order: 53,
      requiredPermissions: ['calendar:read'],
    });
    expect(typeof CalendarPage).toBe('function');
  });

  it('uses date / time pickers and deletes from each event row (#1250)', () => {
    const spec = (CalendarPage as unknown as { spec: {
      actions: readonly { name: string; fields?: readonly { key: string; type?: string }[] }[];
      sections: readonly { id?: string; rowActions?: readonly { name: string; idParamKey?: string; confirm?: unknown }[] }[];
    } }).spec;
    const create = spec.actions.find(action => action.name === 'create')!;
    expect(create.fields?.find(field => field.key === 'date')?.type).toBe('date');
    expect(create.fields?.find(field => field.key === 'time')?.type).toBe('time');
    expect(spec.actions.map(action => action.name)).not.toContain('delete');
    const events = spec.sections.find(section => section.id === 'events')!;
    expect(events.rowActions).toEqual([expect.objectContaining({ name: 'delete', idParamKey: 'id', confirm: expect.anything() })]);
  });

  it('accepts picker times and rejects malformed ones', async () => {
    const runtime = { config: { timezone: 'Asia/Shanghai' }, provider: undefined, auth: undefined } as unknown as CalendarRuntime;
    const create = createCalendarConsoleRpc().methods.get('create')!;
    const created = await create.handler({ title: 'Standup', date: '2026-11-20', time: '10:30:00' }, createCall(runtime)) as Record<string, unknown>;
    expect(created.time).toBe('10:30');
    await expect(Promise.resolve().then(() => create.handler({ title: 'x', date: '2026-11-20', time: '25:00' }, createCall(runtime))))
      .rejects.toBeInstanceOf(PluginConsoleRpcError);
  });
});
