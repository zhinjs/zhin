/** Relative durations for Agent tools: `10m`, `2h`, `1d`, or plain seconds. */
import { ReminderInputError } from "./service.js";

export function parseRelativeDelayMs(value: string): number {
  const text = value.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      throw new ReminderInputError("延迟秒数无效");
    }
    return seconds * 1000;
  }
  const match = /^(\d+)\s*(s|m|h|d|秒|分|分钟|小时|天)$/u.exec(text);
  if (!match) {
    throw new ReminderInputError("时长格式无效（示例：600、10m、2h、1d）");
  }
  const amount = Number(match[1]);
  const unit = match[2]!;
  const factor = {
    s: 1000,
    秒: 1000,
    m: 60_000,
    分: 60_000,
    分钟: 60_000,
    h: 3_600_000,
    小时: 3_600_000,
    d: 86_400_000,
    天: 86_400_000,
  }[unit]!;
  return amount * factor;
}
