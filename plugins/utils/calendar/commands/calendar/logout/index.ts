import { defineCommand } from "zhin.js/command";
import { parseOAuthProvider } from "../../../src/chat-auth.js";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "删除数据库中保存的日历授权（master 专用）",
  params: {
    provider: { type: "string", description: "google 或 microsoft（outlook）" },
  },
  permit: ["role(master)"],
  async execute({ params, use }) {
    const provider = parseOAuthProvider(params.provider);
    if (!provider) {
      return "用法：calendar logout google | calendar logout microsoft";
    }
    return use(calendarRuntimeToken).auth.logout(provider);
  },
});
