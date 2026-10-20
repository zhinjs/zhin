import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { replyReminder } from "../../../../src/caller.js";
import { reminderServiceToken } from "../../../../src/runtime.js";
import { reminderActorFromTool } from "../../../../src/tool-actor.js";

export default defineAgentTool({
  description:
    "Cancel one of your reminders in the current chat by id from reminder_list.",
  requiresApproval: "always",
  tags: ["reminder"],
  keywords: ["取消提醒", "cancel reminder"],
  inputSchema: z.object({
    id: z.string().min(1).describe("Reminder id"),
  }),
  async execute({ id }, context) {
    return replyReminder(async () => {
      const service = context.use(reminderServiceToken);
      const ok = await service.cancel(reminderActorFromTool(context), id);
      return ok
        ? `已取消提醒 ${id}`
        : `找不到提醒 ${id}（或不属于你在当前会话的任务）`;
    });
  },
});
