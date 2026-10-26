import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
export interface StatsRankEntry {
  rank: number;
  userId: string;
  name: string;
  count: number;
  percent: number;
}

export interface StatsRankReportData {
  title: string;
  entries: StatsRankEntry[];
  participantCount: number;
  totalMessages: number;
  myRank?: number;
  myCount?: number;
  empty?: boolean;
}

export interface MyStatsReportData {
  userName: string;
  scope: string;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  totalCount: number;
  activeDays: number;
}

export function buildStatsRankReportData(
  stats: Map<string, { name: string; count: number }>,
  title: string,
  size: number,
  myUserId?: string,
): StatsRankReportData {
  const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  const total = sorted.reduce((s, [, v]) => s + v.count, 0);
  const topCount = sorted[0]?.[1].count || 1;
  const top = sorted.slice(0, size);

  if (top.length === 0) {
    return {
      title,
      entries: [],
      participantCount: 0,
      totalMessages: 0,
      empty: true,
    };
  }

  const entries: StatsRankEntry[] = top.map(([userId, v], i) => ({
    rank: i + 1,
    userId,
    name: v.name,
    count: v.count,
    percent: Math.max(4, Math.round((v.count / topCount) * 100)),
  }));

  let myRank: number | undefined;
  let myCount: number | undefined;
  if (myUserId) {
    const idx = sorted.findIndex(([uid]) => uid === myUserId);
    if (idx >= 0) {
      myRank = idx + 1;
      myCount = sorted[idx][1].count;
    }
  }

  return {
    title,
    entries,
    participantCount: stats.size,
    totalMessages: total,
    myRank,
    myCount,
  };
}

export function formatRankText(data: StatsRankReportData, locale?: Locale): string {
  if (data.empty) return t(locale, 'statsEmpty', { title: data.title });
  const medals = ["🥇", "🥈", "🥉"];
  const lines = data.entries.map((entry) => {
    const prefix = entry.rank <= 3 ? medals[entry.rank - 1] : `${entry.rank}.`;
    return t(locale, 'statsRow', { prefix, name: entry.name, count: entry.count });
  });
  let footer = t(locale, 'statsFooter', { people: data.participantCount, messages: data.totalMessages });
  if (data.myRank != null && data.myCount != null) {
    footer += t(locale, 'statsMyFooter', { rank: data.myRank, count: data.myCount });
  }
  return `${data.title}\n${lines.join("\n")}${footer}`;
}

export function formatMyStatsText(data: MyStatsReportData, locale?: Locale): string {
  return [
    t(locale, 'myStatsTitle', { name: data.userName, scope: data.scope }),
    t(locale, 'todayMessages', { count: data.todayCount }),
    t(locale, 'weekMessages', { count: data.weekCount }),
    t(locale, 'monthMessages', { count: data.monthCount }),
    t(locale, 'totalMessages', { count: data.totalCount }),
    t(locale, 'activeDays', { count: data.activeDays }),
  ].join("\n");
}
