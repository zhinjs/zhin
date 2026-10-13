import { defineCommand } from "zhin.js/command";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "查看日历授权状态（master 专用）",
  permit: ["role(master)"],
  async execute({ use }) {
    return use(calendarRuntimeToken).auth.describeStatus();
  },
});
