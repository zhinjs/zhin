import { definePlugin } from "zhin.js";
import {
  assertCalendarTimezone,
  calendarConfig,
  createCalendarProvider,
} from "./src/index.js";
import { calendarRuntimeToken } from "./src/runtime.js";

export default definePlugin({
  name: "calendar",
  config: calendarConfig,
  metadata: { displayName: "日历" },
  setup(context) {
    const config = context.config.get();
    assertCalendarTimezone(config.timezone);
    const provider = createCalendarProvider(config);
    context.resources.provide(calendarRuntimeToken, { config, provider });
    if (config.provider !== "none" && !provider) {
      console.warn("[calendar] provider 已配置但凭据为空，日历工具将不可用");
    }
  },
});
