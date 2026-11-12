import { randomUUID } from 'node:crypto';
import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from 'zhin.js';
import { DEFAULT_OAUTH_CALLBACK_PATH } from './chat-auth.js';
import type { CalendarConfig } from './config.js';
import { calendarRuntimeToken, type CalendarRuntime } from './runtime.js';

export interface CalendarConsoleEventItem {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly time: string;
  readonly repeat: string;
  readonly createdAt: string;
  readonly [key: string]: string;
}

type CalendarRuntimeLookup = {
  readonly use?: (token: typeof calendarRuntimeToken) => CalendarRuntime | undefined;
};

type ExtendedCalendarConfig = CalendarConfig & {
  readonly workday_start_hour?: number;
  readonly workday_end_hour?: number;
};

function resolveCalendarRuntime(call: PluginConsoleRpcCall, fallback?: CalendarRuntime): CalendarRuntime {
  const runtime = (call.runtime as CalendarRuntimeLookup | undefined)?.use?.(calendarRuntimeToken) ?? fallback;
  if (!runtime) {
    throw new PluginConsoleRpcError('unavailable', 'Calendar runtime is not initialized');
  }
  return runtime;
}

export function createCalendarConsoleRpc(defaultRuntime?: CalendarRuntime): PluginConsoleRpc {
  const localEvents: CalendarConsoleEventItem[] = [];

  return definePluginConsoleRpc({
    // Day-to-day edits belong to operators; `:write` would otherwise infer `manage` (ADR 0049).
    permissions: [{ id: 'calendar:write', level: 'operate', description: '编辑日程' }],
    status: {
      page: 'index',
      requiredPermissions: ['calendar:read'],
      handler(_input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): PluginConsoleRpcJson {
        const runtime = resolveCalendarRuntime(call, defaultRuntime);
        const cfg = runtime.config as ExtendedCalendarConfig;
        const start =
          cfg.workday_start_hour !== undefined
            ? `${cfg.workday_start_hour}:00`
            : cfg.work_day_start?.trim() || '09:00';
        const end =
          cfg.workday_end_hour !== undefined
            ? `${cfg.workday_end_hour}:00`
            : cfg.work_day_end?.trim() || '18:00';
        return {
          provider: cfg.provider,
          timezone: cfg.timezone,
          ready: Boolean(runtime.provider),
          oauthCallbackPath: cfg.oauth_callback_path?.trim() || DEFAULT_OAUTH_CALLBACK_PATH,
          workingHours: `${start} - ${end}`,
          ...(localEvents.length > 0
            ? {
                eventCount: localEvents.length,
                events: [...localEvents],
              }
            : {}),
        };
      },
    },
    actions: {
      create: {
        page: 'index',
        requiredPermissions: ['calendar:write'],
        async handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
          const runtime = resolveCalendarRuntime(call, defaultRuntime);
          const title = typeof input.title === 'string' ? input.title.trim() : '';
          if (!title) {
            throw new PluginConsoleRpcError('invalid_input', '请输入日程标题');
          }
          const date = typeof input.date === 'string' ? input.date.trim() : '';
          if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
            throw new PluginConsoleRpcError('invalid_input', '请提供 YYYY-MM-DD 格式的日期');
          }
          const time =
            typeof input.time === 'string' && input.time.trim()
              ? input.time.trim()
              : '09:00';
          const repeat =
            typeof input.repeat === 'string' &&
            ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(input.repeat)
              ? input.repeat
              : 'none';

          let id = randomUUID().slice(0, 8);
          if (runtime.provider) {
            try {
              const start = new Date(`${date}T${time}:00`);
              const end = new Date(start.getTime() + 3600_000);
              if (!Number.isNaN(start.getTime())) {
                const created = await runtime.provider.createEvent(
                  { title, start, end },
                  call.signal,
                );
                if (created?.id) id = created.id;
              }
            } catch {
              // Keep console event creation working even when external provider is unreachable
            }
          }

          const eventItem: CalendarConsoleEventItem = {
            id,
            title,
            date,
            time,
            repeat,
            createdAt: new Date().toISOString(),
          };
          localEvents.unshift(eventItem);
          return {
            ok: true,
            id,
            title,
            date,
            time,
            repeat,
            message: `已添加日程：${title} (${date} ${time})`,
          };
        },
      },
      delete: {
        page: 'index',
        requiredPermissions: ['calendar:write'],
        handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): PluginConsoleRpcJson {
          resolveCalendarRuntime(call, defaultRuntime);
          const id = typeof input.id === 'string' ? input.id.trim() : '';
          if (!id) {
            throw new PluginConsoleRpcError('invalid_input', '请提供要删除的日程 ID');
          }
          const idx = localEvents.findIndex((item) => item.id === id);
          const removed = idx >= 0;
          if (removed) {
            localEvents.splice(idx, 1);
          }
          return {
            ok: removed,
            id,
            message: removed ? `已删除日程 ${id}` : `未找到日程 ${id}`,
          };
        },
      },
    },
  });
}
