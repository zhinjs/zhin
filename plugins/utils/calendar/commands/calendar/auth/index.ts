import { defineCommand } from "zhin.js/command";
import { createDeliveryTarget } from "zhin.js";
import { parseOAuthProvider } from "../../../src/chat-auth.js";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "通过聊天完成 Google / Outlook 日历 OAuth 授权（master 专用）",
  params: {
    provider: { type: "string", description: "google 或 microsoft（outlook）" },
  },
  permit: ["role(master)"],
  async execute({ input, params, use }) {
    const provider = parseOAuthProvider(params.provider);
    if (!provider) {
      return "用法：calendar auth google | calendar auth microsoft";
    }
    if (!input?.sender?.id) {
      return "请在私聊或群聊中发送该命令";
    }
    const requester = {
      sender_id: input.sender.id,
      target: createDeliveryTarget(input),
    };
    return use(calendarRuntimeToken).auth.startAuthorization(
      provider,
      requester
    );
  },
});
