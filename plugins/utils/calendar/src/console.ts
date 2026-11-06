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
  return definePluginConsoleRpc({
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
        };
      },
    },
  });
}
