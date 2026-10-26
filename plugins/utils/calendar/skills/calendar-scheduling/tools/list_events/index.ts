import { messages as t } from '../../../../src/i18n.js';
import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { calendarRuntimeToken } from "../../../../src/runtime.js";
import { runCalendarTool } from "../../../../src/tool-errors.js";
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
    return runCalendarTool(async () => {
      const runtime = context.use(calendarRuntimeToken);
      if (!runtime.provider)
        return t(context.locale, 'disabled');
      const timezone = runtime.config.timezone;
      const events = await runtime.provider.listEvents(
        parseDateTimeInZone(from, timezone),
        parseDateTimeInZone(to, timezone),
        context.signal
      );
      if (events.length === 0)
        return t(context.locale, 'noEvents', { provider: runtime.provider.name, from, to });
      return events
        .map(
          (event) =>
            `• ${event.start} → ${event.end}  ${event.title}${
              event.location ? ` @ ${event.location}` : ""
            }  [${event.id}]`
        )
        .join("\n");
    }, context.locale);
  },
});
