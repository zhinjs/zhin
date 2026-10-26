import { reminderMessages as t } from '../../../../src/i18n.js';
import { defineAgentTool } from "@zhin.js/tool";
import { z } from "zod";
import { replyReminder } from "../../../../src/caller.js";
import { reminderServiceToken } from "../../../../src/runtime.js";
import { reminderActorFromTool } from "../../../../src/tool-actor.js";

export default defineAgentTool({
  description:
    "List pending personal reminders for the current sender in the current chat.",
  requiresApproval: "never",
  tags: ["reminder"],
  keywords: ["提醒列表", "list reminders"],
  inputSchema: z.object({}),
  async execute(_input, context) {
    return replyReminder(async () => {
      const service = context.use(reminderServiceToken);
      const tasks = await service.list(reminderActorFromTool(context));
      if (tasks.length === 0) return t(context.locale, 'toolEmpty');
      return tasks.map((task) => service.describe(task, context.locale)).join("\n---\n");
    });
  },
});
