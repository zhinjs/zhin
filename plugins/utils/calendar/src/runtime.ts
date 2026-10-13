import { createToken } from "zhin.js";
import type { CalendarConfig } from "./config.js";
import type { CalendarProvider } from "./types.js";

export interface CalendarRuntime {
  readonly config: CalendarConfig;
  readonly provider: CalendarProvider | undefined;
}

export const calendarRuntimeToken = createToken<CalendarRuntime>(
  "zhin.calendar.runtime",
  "Owner-scoped calendar provider and config"
);
