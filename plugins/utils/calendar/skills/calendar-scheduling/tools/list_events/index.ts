import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { calendarRuntimeToken } from "../../../../src/runtime.js";
import { parseDateTimeInZone } from "../../../../src/time.js";

export default defineAgentTool({
  description:
    "List calendar events between two datetimes in the configured timezone.",
  requiresApproval: "never",
  tags: ["calendar"],
  keywords: ["日历", "日程", "events", "list events"],
  inputSchema: z.object({
    from: z
      .string()
      .describe("Start YYYY-MM-DDTHH:mm (configured timezone if no offset)"),
    to: z.string().describe("End YYYY-MM-DDTHH:mm"),
  }),
  async execute({ from, to }, context) {
    const runtime = context.use(calendarRuntimeToken);
    if (!runtime.provider)
      return "日历未启用：请在 plugins.calendar 配置 provider（caldav / google / microsoft）与凭据";
    const timezone = runtime.config.timezone;
    const events = await runtime.provider.listEvents(
      parseDateTimeInZone(from, timezone),
      parseDateTimeInZone(to, timezone),
      context.signal
    );
    if (events.length === 0)
      return `（${runtime.provider.name}）${from} ~ ${to} 没有事件`;
    return events
      .map(
        (event) =>
          `• ${event.start} → ${event.end}  ${event.title}${
            event.location ? ` @ ${event.location}` : ""
          }  [${event.id}]`
      )
      .join("\n");
  },
});
