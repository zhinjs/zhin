import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi<any>('/moyu');
  if (typeof data === 'string') return `🐟 摸鱼日历\n\n${data}`;
  const lines = ['🐟 摸鱼日历', ''];
  if (data.date?.gregorian) lines.push(`📅 ${data.date.gregorian} ${data.date.weekday || ''}`);
  if (data.date?.lunar) {
    const l = data.date.lunar;
    lines.push(`🌙 农历${l.monthCN || ''}${l.dayCN || ''} ${l.yearGanZhi || ''}年`);
  }
  if (data.today) {
    const t = data.today;
    if (t.holidayName) lines.push(`🎉 ${t.holidayName}`);
    if (t.solarTerm) lines.push(`🌿 ${t.solarTerm}`);
    lines.push(t.isWorkday ? '💼 今天是工作日' : '🎮 今天不上班');
  }
  if (data.festivals && Array.isArray(data.festivals)) {
    data.festivals.forEach((f: any) => lines.push(`🎊 ${f.name || f}`));
  }
  if (data.countdown && Array.isArray(data.countdown)) {
    lines.push('');
    data.countdown.forEach((c: any) => {
      if (c.name && c.days !== undefined) lines.push(`⏳ 距 ${c.name} 还有 ${c.days} 天`);
    });
  }
  return lines.join('\n');
}
