import type { Locale } from 'zhin.js/i18n';
import { messages as t } from '../i18n.js';
import { asArray, asRecord, asString, type ApiPayload } from '../api.js';
import type { SixtySClient } from '../client.js';

export default async function (client: SixtySClient, locale?: Locale) {
  const data = await client.fetch<ApiPayload | string>('/moyu', undefined, locale);
  if (typeof data === 'string') return `${t(locale, 'moyu')}\n\n${data}`;
  const lines = [t(locale, 'moyu'), ''];
  const date = asRecord(data.date);
  if (date.gregorian) lines.push(`📅 ${date.gregorian} ${asString(date.weekday)}`);
  const lunar = asRecord(date.lunar);
  if (lunar.monthCN || lunar.dayCN) {
    lines.push(t(locale, 'lunar', { month: asString(lunar.monthCN), day: asString(lunar.dayCN), year: asString(lunar.yearGanZhi) }));
  }
  const today = asRecord(data.today);
  if (today.holidayName) lines.push(`🎉 ${today.holidayName}`);
  if (today.solarTerm) lines.push(`🌿 ${today.solarTerm}`);
  if (today.isWorkday !== undefined) {
    lines.push(today.isWorkday ? t(locale, 'workday') : t(locale, 'dayoff'));
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
        lines.push(t(locale, 'countdown', { name: row.name, days: row.days }));
      }
    });
  }
  return lines.join('\n');
}
