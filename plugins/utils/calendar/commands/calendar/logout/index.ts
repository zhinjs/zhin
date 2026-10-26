import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from "zhin.js/command";
import { parseOAuthProvider } from "../../../src/chat-auth.js";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "删除数据库中保存的日历授权（master 专用）", descriptionI18n: { en: "Delete a calendar authorization stored in the database (bot master only)" },
  params: {
    provider: { type: "string", description: "google 或 microsoft（outlook）", descriptionI18n: { en: "google or microsoft (outlook)" } },
  },
  permit: ["role(master)"],
  async execute({ params, use, locale, formatCommand }) {
    const provider = parseOAuthProvider(params.provider);
    if (!provider) {
      return formatCommand('calendar logout') ? t(locale, 'usage', { command: formatCommand('calendar logout')! }) : t(locale, 'providerInput');
    }
    return use(calendarRuntimeToken).auth.logout(provider, locale);
  },
});
