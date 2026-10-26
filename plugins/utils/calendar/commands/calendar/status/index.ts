import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from "zhin.js/command";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "查看日历授权状态（master 专用）", descriptionI18n: { en: "View calendar authorization status (bot master only)" },
  permit: ["role(master)"],
  async execute({ use, locale, formatCommand }) {
    return use(calendarRuntimeToken).auth.describeStatus(locale, formatCommand('calendar auth'));
  },
});
