import type { Locale } from 'zhin.js/i18n';
import type { DynamicItem, LiveInfo, RoomInfo } from './api.js';
import { messages as t } from './i18n.js';

export function liveStatusText(status: number, locale: Locale = 'zh-CN'): string {
  return status === 0 ? t(locale, 'offline') : status === 1 ? t(locale, 'broadcasting')
    : status === 2 ? t(locale, 'replay') : t(locale, 'statusUnknown', { status });
}

function since(liveTime: number, nowMs: number, locale: Locale): string {
  if (liveTime <= 0) return '';
  const minutes = Math.max(0, Math.floor((nowMs / 1000 - liveTime) / 60));
  return minutes < 60 ? t(locale, 'minutes', { minutes }) : t(locale, 'hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function formatLiveStart(info: LiveInfo, locale: Locale = 'zh-CN'): string {
  const lines = [t(locale, 'started', { name: info.uname || info.uid })];
  if (info.title) lines.push(t(locale, 'title', { title: info.title }));
  if (info.area) lines.push(t(locale, 'area', { area: info.area }));
  if (info.url) lines.push(info.url);
  return lines.join('\n');
}

export function formatDynamic(uname: string, item: DynamicItem, locale: Locale = 'zh-CN'): string {
  return t(locale, 'post', { name: item.author || uname, summary: item.summary, url: item.url });
}

export function formatRoom(room: RoomInfo, uname: string, liveTime: number, nowMs: number = Date.now(), locale: Locale = 'zh-CN'): string {
  const name = uname ? t(locale, 'namedRoom', { name: uname }) : t(locale, 'liveRoom');
  const lines = [`${name} ${room.roomId}${locale === 'en' ? ': ' : '：'}${liveStatusText(room.liveStatus, locale)}`];
  if (room.title) lines.push(t(locale, 'title', { title: room.title }));
  if (room.area) lines.push(t(locale, 'area', { area: room.area }));
  if (room.liveStatus === 1) {
    const elapsed = since(liveTime, nowMs, locale);
    if (elapsed) lines.push(elapsed);
    if (room.online > 0) lines.push(t(locale, 'popularity', { count: room.online }));
  }
  lines.push(room.url);
  return lines.join('\n');
}
