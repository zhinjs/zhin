import { asArray, asRecord, asString, fetchApi, type ApiPayload } from '../api.js';

export default async function () {
  const data = await fetchApi<ApiPayload | string>('/moyu');
  if (typeof data === 'string') return `🐟 摸鱼日历\n\n${data}`;
  const lines = ['🐟 摸鱼日历', ''];
  const date = asRecord(data.date);
  if (date.gregorian) lines.push(`📅 ${date.gregorian} ${asString(date.weekday)}`);
  const lunar = asRecord(date.lunar);
  if (lunar.monthCN || lunar.dayCN) {
    lines.push(`🌙 农历${asString(lunar.monthCN)}${asString(lunar.dayCN)} ${asString(lunar.yearGanZhi)}年`);
  }
  const today = asRecord(data.today);
  if (today.holidayName) lines.push(`🎉 ${today.holidayName}`);
  if (today.solarTerm) lines.push(`🌿 ${today.solarTerm}`);
  if (today.isWorkday !== undefined) {
    lines.push(today.isWorkday ? '💼 今天是工作日' : '🎮 今天不上班');
  }
  if (Array.isArray(data.festivals)) {
    data.festivals.forEach((f: unknown) => {
      lines.push(`🎊 ${typeof f === 'string' ? f : asString(asRecord(f).name ?? f)}`);
    });
  }
  const countdown = asArray(data.countdown);
  if (countdown.length > 0) {
    lines.push('');
    countdown.forEach((c: unknown) => {
      const row = asRecord(c);
      if (typeof row.name === 'string' && typeof row.days === 'number') {
        lines.push(`⏳ 距 ${row.name} 还有 ${row.days} 天`);
      }
    });
  }
  return lines.join('\n');
}
