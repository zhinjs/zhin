import { createToken } from "zhin.js";
import type { CalendarConfig } from "./config.js";
import type { CalendarProvider } from "./types.js";
import type { CalendarAuthService } from "./chat-auth.js";

export interface CalendarRuntime {
  readonly config: CalendarConfig;
  readonly provider: CalendarProvider | undefined;
  /** Chat authorization flow used by the `calendar` commands. */
  readonly auth: CalendarAuthService<unknown>;
}

export const calendarRuntimeToken = createToken<CalendarRuntime>(
  "zhin.calendar.runtime",
  "Owner-scoped calendar provider and config"
);
