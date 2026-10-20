import type { DynamicItem, LiveInfo, RoomInfo } from './api.js';

const LIVE_STATUS_TEXT: Record<number, string> = { 0: '未开播', 1: '直播中', 2: '轮播中' };

export function liveStatusText(status: number): string {
  return LIVE_STATUS_TEXT[status] ?? `未知状态 (${status})`;
}

function since(liveTime: number, nowMs: number): string {
  if (liveTime <= 0) return '';
  const minutes = Math.max(0, Math.floor((nowMs / 1000 - liveTime) / 60));
  if (minutes < 60) return `已开播 ${minutes} 分钟`;
  return `已开播 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function formatLiveStart(info: LiveInfo): string {
  const lines = [`【开播】${info.uname || info.uid} 开播啦！`];
  if (info.title) lines.push(`标题：${info.title}`);
  if (info.area) lines.push(`分区：${info.area}`);
  if (info.url) lines.push(info.url);
  return lines.join('\n');
}

export function formatDynamic(uname: string, item: DynamicItem): string {
  return `【动态】${item.author || uname} ${item.summary}\n${item.url}`;
}

export function formatRoom(room: RoomInfo, uname: string, liveTime: number, nowMs: number = Date.now()): string {
  const lines = [`${uname ? `${uname} 的直播间` : '直播间'} ${room.roomId}：${liveStatusText(room.liveStatus)}`];
  if (room.title) lines.push(`标题：${room.title}`);
  if (room.area) lines.push(`分区：${room.area}`);
  if (room.liveStatus === 1) {
    const elapsed = since(liveTime, nowMs);
    if (elapsed) lines.push(elapsed);
    if (room.online > 0) lines.push(`人气：${room.online}`);
  }
  lines.push(room.url);
  return lines.join('\n');
}
